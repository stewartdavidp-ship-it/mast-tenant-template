"use strict";
var MastCustomerResolver = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/index.ts
  var src_exports = {};
  __export(src_exports, {
    canonicalizeEmail: () => canonicalizeEmail,
    emailKey: () => emailKey,
    resolveCustomer: () => resolveCustomer,
    resolveCustomerSafe: () => resolveCustomerSafe,
    resolveOrderContact: () => resolveOrderContact,
    resolveOrderContactSafe: () => resolveOrderContactSafe
  });

  // src/resolve-customer.ts
  var GMAIL_DOMAINS = /* @__PURE__ */ new Set(["gmail.com", "googlemail.com"]);
  function canonicalizeEmail(email) {
    if (!email) return null;
    const trimmed = String(email).trim().toLowerCase();
    if (!trimmed) return null;
    const at = trimmed.lastIndexOf("@");
    if (at <= 0 || at === trimmed.length - 1) return trimmed;
    let local = trimmed.slice(0, at);
    let domain = trimmed.slice(at + 1);
    if (GMAIL_DOMAINS.has(domain)) {
      const plus = local.indexOf("+");
      if (plus !== -1) local = local.slice(0, plus);
      local = local.replace(/\./g, "");
      domain = "gmail.com";
    }
    return local + "@" + domain;
  }
  function firebaseSafeKey(s) {
    if (!s) return null;
    return s.replace(/[.#$[\]/]/g, ",");
  }
  function emailKey(email) {
    return firebaseSafeKey(canonicalizeEmail(email));
  }
  function normalizeEmail(email) {
    if (!email) return null;
    return String(email).trim().toLowerCase();
  }
  async function claimEmailKey(config, eKey, customerId) {
    const { tenantId, storage } = config;
    const path = `${tenantId}/admin/customerIndexes/byEmail/${eKey}`;
    if (typeof storage.claim === "function") {
      return storage.claim(path, customerId);
    }
    const existing = await storage.get(path);
    if (existing) return existing;
    await storage.multiUpdate({ [path]: customerId });
    return customerId;
  }
  async function resolveCustomer(config, params) {
    const { tenantId, storage } = config;
    const uid = params.uid || null;
    const email = normalizeEmail(params.email);
    const contactId = params.contactId || null;
    const displayName = params.displayName || "";
    const source = params.source;
    const phone = params.phone || null;
    if (!uid && !email && !contactId) {
      return { customerId: null, created: false, conflict: false, skipped: true };
    }
    const eKey = emailKey(email);
    const customerIdByUid = uid ? await storage.get(`${tenantId}/admin/customerIndexes/byUid/${uid}`) : null;
    const customerIdByEmail = eKey ? await storage.get(`${tenantId}/admin/customerIndexes/byEmail/${eKey}`) : null;
    const customerIdByContact = contactId ? await storage.get(`${tenantId}/admin/customerIndexes/byContactId/${contactId}`) : null;
    let conflict = false;
    let conflictPartnerId = null;
    if (customerIdByUid && customerIdByEmail && customerIdByUid !== customerIdByEmail) {
      conflict = true;
      conflictPartnerId = customerIdByEmail;
    }
    const existingId = customerIdByUid || customerIdByEmail || customerIdByContact;
    if (existingId) {
      return attachToExisting(config, existingId, {
        uid,
        email,
        eKey,
        contactId,
        source,
        // The byEmail index already points at this customer (or we're attaching
        // via uid/contactId) — don't re-claim it inside the attach helper.
        emailAlreadyIndexed: !!customerIdByEmail,
        conflict,
        conflictPartnerId,
        conflictPrimaryId: customerIdByUid
      });
    }
    const customerId = storage.pushKey(`${tenantId}/admin/customers`);
    if (eKey) {
      const winner = await claimEmailKey(config, eKey, customerId);
      if (winner !== customerId) {
        return attachToExisting(config, winner, {
          uid,
          email,
          eKey,
          contactId,
          source,
          emailAlreadyIndexed: true,
          // claim already points eKey → winner
          conflict: false,
          conflictPartnerId: null,
          conflictPrimaryId: null
        });
      }
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const record = {
      id: customerId,
      displayName: displayName || email || "",
      primaryEmail: email || "",
      emails: email ? [email] : [],
      phones: phone ? [phone] : [],
      addresses: [],
      linkedIds: {
        uids: uid ? [uid] : [],
        contactIds: contactId ? [contactId] : [],
        studentIds: [],
        squareCustomerId: null
      },
      tags: [],
      notes: "",
      marketing: {
        newsletterOptIn: source === "newsletter",
        smsOptIn: false
      },
      source,
      status: "active",
      createdAt: now,
      updatedAt: now,
      mergedFrom: []
    };
    const createUpdates = {};
    createUpdates[`${tenantId}/admin/customers/${customerId}`] = record;
    if (uid) createUpdates[`${tenantId}/admin/customerIndexes/byUid/${uid}`] = customerId;
    if (contactId)
      createUpdates[`${tenantId}/admin/customerIndexes/byContactId/${contactId}`] = customerId;
    await storage.multiUpdate(createUpdates);
    return { customerId, created: true, conflict: false };
  }
  async function attachToExisting(config, existingId, p) {
    const { tenantId, storage } = config;
    const { uid, email, eKey, contactId, source } = p;
    const existing = await storage.get(
      `${tenantId}/admin/customers/${existingId}`
    );
    const rec = existing || {};
    const updates = {};
    const linked = rec.linkedIds || {
      uids: [],
      contactIds: [],
      studentIds: [],
      squareCustomerId: null
    };
    let changed = false;
    if (uid && !(linked.uids || []).includes(uid)) {
      linked.uids = [...linked.uids || [], uid];
      updates[`${tenantId}/admin/customerIndexes/byUid/${uid}`] = existingId;
      changed = true;
    }
    if (contactId && !(linked.contactIds || []).includes(contactId)) {
      linked.contactIds = [...linked.contactIds || [], contactId];
      updates[`${tenantId}/admin/customerIndexes/byContactId/${contactId}`] = existingId;
      changed = true;
    }
    if (email && !(rec.emails || []).includes(email)) {
      updates[`${tenantId}/admin/customers/${existingId}/emails`] = [
        ...rec.emails || [],
        email
      ];
      changed = true;
    }
    if (eKey && !p.emailAlreadyIndexed) {
      await claimEmailKey(config, eKey, existingId);
    }
    if (source === "newsletter" && !(rec.marketing && rec.marketing.newsletterOptIn)) {
      updates[`${tenantId}/admin/customers/${existingId}/marketing/newsletterOptIn`] = true;
      changed = true;
    }
    if (changed) {
      updates[`${tenantId}/admin/customers/${existingId}/linkedIds`] = linked;
      updates[`${tenantId}/admin/customers/${existingId}/updatedAt`] = (/* @__PURE__ */ new Date()).toISOString();
      await storage.multiUpdate(updates);
    }
    if (p.conflict && p.conflictPartnerId) {
      const flagId = storage.pushKey(`${tenantId}/admin/customerDuplicates`);
      await storage.multiUpdate({
        [`${tenantId}/admin/customerDuplicates/${flagId}`]: {
          customerIdA: p.conflictPrimaryId,
          customerIdB: p.conflictPartnerId,
          reason: "uid and email resolve to different customers",
          sourceRecord: { uid, email, source },
          detectedAt: (/* @__PURE__ */ new Date()).toISOString(),
          status: "open"
        }
      });
    }
    return { customerId: existingId, created: false, conflict: p.conflict };
  }
  async function resolveCustomerSafe(config, params) {
    try {
      const result = await resolveCustomer(config, params);
      return result.customerId;
    } catch (e) {
      console.warn(`[customer-resolver] resolveCustomerSafe failed:`, e);
      return null;
    }
  }

  // src/resolve-order-contact.ts
  function normalizeEmail2(email) {
    if (!email) return null;
    return String(email).trim().toLowerCase();
  }
  function normKey(s) {
    if (!s) return "";
    return String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
  }
  function flattenShipping(shipping) {
    if (!shipping) return "";
    const parts = [
      shipping.address1 || "",
      shipping.address2 || "",
      shipping.city || "",
      shipping.state || "",
      shipping.zip || ""
    ].filter(Boolean);
    return parts.join(", ");
  }
  function contactMatchKey(contact) {
    if (!contact || !contact.address) return null;
    return normKey(contact.email || "") + "|" + normKey(contact.address);
  }
  async function resolveOrderContact(config, params) {
    const { tenantId, storage } = config;
    const customerId = params.customerId;
    const shipping = params.shipping;
    const email = normalizeEmail2(params.email);
    const phone = params.phone || null;
    if (!customerId) return null;
    if (!shipping || !shipping.address1) return null;
    const flatAddress = flattenShipping(shipping);
    const wantedKey = normKey(email || "") + "|" + normKey(flatAddress);
    const customer = await storage.get(
      `${tenantId}/admin/customers/${customerId}`
    );
    const rec = customer || {};
    const linked = rec.linkedIds || {};
    const linkedContactIds = linked.contactIds || [];
    for (const cid of linkedContactIds) {
      try {
        const c = await storage.get(
          `${tenantId}/admin/contacts/${cid}`
        );
        if (!c) continue;
        const key = contactMatchKey(c);
        if (key && key === wantedKey) {
          return cid;
        }
      } catch (e) {
        console.warn(`[customer-resolver] linked contact read failed`, cid, e);
      }
    }
    const newId = storage.pushKey(`${tenantId}/admin/contacts`);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const newContact = {
      id: newId,
      customerId,
      name: shipping.name || rec.displayName || "",
      email: email || rec.primaryEmail || "",
      phone: phone || "",
      address: flatAddress,
      category: "Other",
      source: "order",
      createdAt: now,
      updatedAt: now
    };
    const updates = {};
    updates[`${tenantId}/admin/contacts/${newId}`] = newContact;
    updates[`${tenantId}/admin/customerIndexes/byContactId/${newId}`] = customerId;
    updates[`${tenantId}/admin/customers/${customerId}/linkedIds/contactIds`] = linkedContactIds.concat([newId]);
    updates[`${tenantId}/admin/customers/${customerId}/updatedAt`] = now;
    await storage.multiUpdate(updates);
    return newId;
  }
  async function resolveOrderContactSafe(config, params) {
    try {
      return await resolveOrderContact(config, params);
    } catch (e) {
      console.warn(`[customer-resolver] resolveOrderContactSafe failed:`, e);
      return null;
    }
  }
  return __toCommonJS(src_exports);
})();
