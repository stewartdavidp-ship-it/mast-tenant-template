---
# Shir Glassworks — Workflow Reference

A living document tracking all key workflows in the Shir Glassworks business app.
Updated by Claude Code as builds complete.

**Status values:**
- `Live` — built and available today
- `In Progress` — currently being built
- `Planned` — designed but not yet started
- `Not Started` — identified but not yet designed

---

## Selling — Craft Fair

### Run the Point of Sale at a Craft Fair
**Status:** Live

Used at craft fairs and shows to ring up a sale, take payment, and send the customer a receipt — all from a phone or tablet.

1. Open the Shir POS app on your phone or tablet
2. Point the camera at the piece the customer wants to buy
3. The app identifies the piece and shows the price — confirm it's correct
4. If the piece isn't recognized, select it manually from the product list
5. Add more pieces to the cart if the customer is buying multiple items
6. Review the cart total with the customer
7. Select payment method: Cash or Square (card)
8. For Square: hand the reader to the customer to tap or swipe
9. For Cash: enter the amount tendered and confirm
10. Ask if the customer wants a receipt — enter their email or phone number
11. Sale is recorded and inventory is updated automatically

---

## Selling — Online

### Customer Purchases from the Website
**Status:** In Progress

How a customer buys from shirglassworks.com — from browsing to payment confirmation.

1. Customer browses the shop and adds pieces to their cart
2. Customer opens the cart and proceeds to checkout
3. Customer enters their shipping address
4. Address is validated automatically — customer corrects it if needed
5. Shipping cost is calculated and shown (free for orders over $100)
6. Customer reviews the order total including shipping
7. Customer enters payment details via Square's secure checkout
8. Payment is processed — customer sees an order confirmation
9. Order appears in the admin app under Retail Orders

---

## Order Fulfillment

### Process and Ship a Website Order
**Status:** Live

What Ori or Madeline does after a customer places an order online — from confirming the order through to dropping it at the post office.

1. Open the admin app and go to Sell → Retail Orders
2. Find the new order (status: Placed)
3. Review the order details — items, options, shipping address
4. If the item is in stock: click Confirm Order (status moves to Packing)
5. If the item needs to be made: a production job is created automatically
6. Pack the order — scan the QR label to mark it packed in the system
7. Click Download Shipping CSV on the confirmed order
8. Open Pirate Ship (pirateships.com) and import the CSV
9. Purchase the shipping label in Pirate Ship
10. Print the label and attach it to the package
11. Return to the admin app and scan packages at drop-off to bundle them
12. Confirm drop-off — carrier and location are recorded
13. Customer receives notification that their order is on its way

---

## Events

### Set Up and Run a Craft Fair Event
**Status:** Live

How to create an event in the system, allocate the inventory you're bringing, and track sales during the show.

1. Open the admin app and go to Sell → Events
2. Click New Event — enter the event name, date, and location
3. Add the pieces you're bringing: search by product name and set the quantity for each
4. Print the packing list if needed
5. At the fair, open the POS app — the recommended way is to click "Open PoS" on the active event in the admin app, which pre-links the event automatically
6. If you open the POS without a pre-linked event, it detects your location and shows a confirmation dialog with the active event(s) — confirm the right one, pick a different event, or dismiss
7. Use the ⚙ button in the top bar at any time to switch events, unlink, or link to a different active event
8. Ring up sales as normal — sold quantities are tracked against your allocation
9. The event banner shows: packed / sold / remaining at a glance

### Wrap Up After a Craft Fair
**Status:** Live

Reconciling what sold at a fair so inventory stays accurate back at the studio.

1. After the event, open the admin app and go to Sell → Events
2. Open the event and review the sold vs. packed summary
3. Confirm any sales that were taken offline or outside the POS
4. Mark the event as complete
5. Inventory is updated automatically based on what was sold
6. Unsold pieces are returned to available stock

---

## Production

### Start a Production Run
**Status:** Live

Creating a build job when it's time to make a batch of pieces — whether triggered by a customer order or to restock.

1. Open the admin app and go to Make → Production
2. Click New Job
3. Enter the job name (e.g. "Spring restock — small bowls")
4. Add the pieces to make: search by product name and set the target quantity for each
5. Set the expected completion date
6. Save the job — it appears in the Queue
7. As work progresses, update the status: In Progress → Ready

### Complete a Production Run and Update Inventory
**Status:** Live

Closing out a build job once the pieces are finished and ready for sale.

1. Open the admin app and go to Make → Production → Jobs
2. Find the job and open it
3. Review the finished quantities — adjust if any pieces didn't turn out
4. Mark the job as Complete
5. Inventory is updated automatically with the finished quantities
6. Pieces are now available for sale online and at events

---

## Inventory

### Update Stock After a Firing
**Status:** Live

A quick way to update inventory counts after pieces come out of the kiln, without going through a full production job.

1. Open the admin app and go to Make → Production → Inventory
2. Find the product you're updating
3. Enter the new on-hand count or adjust by the number of pieces added
4. Save — the updated count is immediately reflected in the shop

### Move Inventory Between Locations
**Status:** Live

Tracking where pieces are stored — studio shelves, display cases, fair bins — so you always know where to find something.

1. Open the admin app and go to Make → Production → Inventory
2. Select the piece you're moving
3. Update the location — or scan the QR code at the destination location
4. Confirm the move
5. The piece now shows as being at the new location

---

## Product Management

### Add a New Product
**Status:** Live

Bringing a new piece into the system so it can be sold online and tracked in inventory.

1. Open the Studio Companion app on your phone
2. Tap Identify & Train
3. Take a photo of the piece
4. The app suggests a name and category based on what it sees — confirm or correct
5. A new product record is created automatically
6. In the admin app, go to Manage → Products and open the new product
7. Set the price, options (color, size, etc.), weight, and shipping category
8. Add more photos if needed
9. Toggle the product to Published when it's ready to appear in the shop
10. Print a QR label from the product record to attach to the piece or its storage location

### Edit an Existing Product
**Status:** Live

Updating price, options, images, or visibility for a product already in the system.

1. Open the admin app and go to Manage → Products
2. Find the product — search by name or browse by category
3. Click Edit
4. Make changes: price, options, description, images, or visibility
5. Save — changes are live on the website immediately

### Manage Product Images
**Status:** Live

Uploading photos to the image library and assigning them to products or website sections.

1. Open the admin app and go to Manage → Images
2. Click Upload and select photos from your device
3. Tag the image with the relevant product or website section
4. To assign to a product: open the product in Manage → Products and select from the image library
5. To use on the website: assign the image to the relevant section in Market → Website Content

---

## Contacts & Relationships

### Add a New Contact
**Status:** Live

Bringing a vendor, partner, gallery, or other business contact into the system so interactions can be tracked over time.

1. Open the admin app and go to Manage → Contacts
2. Click Add Contact
3. Enter the contact name, category (Supplier, Gallery, Event Organizer, etc.), and optional notes
4. Optionally paste their Google Drive folder link for document access
5. Save — the contact is created in Studio and synced to Google Contacts automatically
6. A "Shir Glassworks" label is added to the contact in Google Contacts

### Log an Interaction with a Contact
**Status:** Live

Recording a call, meeting, payment, or other touchpoint so there's a full history of the relationship.

1. Open the admin app and go to Manage → Contacts
2. Find the contact and open their record
3. Click Log Interaction
4. Set the date (defaults to today), type (Call, Email, Meeting, etc.), and add notes on what happened
5. Optionally attach a document — paste a Drive link or upload a file directly
6. Save — the interaction appears in the contact's timeline, newest first
7. Any uploaded document is saved to the contact's Google Drive folder automatically

### Sync Contacts from Google
**Status:** Live

Pulling in contacts that were added directly to the "Shir Glassworks" group in Google Contacts, rather than through Studio.

1. Open the admin app and go to Manage → Contacts
2. Click Sync from Google Contacts
3. Studio fetches all contacts in the "Shir Glassworks" group and creates any missing records
4. New contacts appear with category set to "Other" — update their category as needed

---

## Admin

### Configure Square Payment Settings
**Status:** Live

Switching between sandbox (test) mode and live payments, and updating Square credentials. Sandbox mode is for testing only — no real money moves.

1. Open the admin app and go to Manage → Settings & Integrations
2. Find the Square section
3. To test: set Environment to Sandbox and enter the Sandbox Application ID and Location ID
4. To go live: set Environment to Production (live credentials are already saved)
5. Click Save
6. In Sandbox mode a TEST MODE banner appears on the checkout page — verify this is visible before testing

### Manage Employees and Permissions
**Status:** Live

Adding a new team member or updating what someone can access in the admin app.

1. Open the admin app and go to Manage → Employees & Permissions
2. To add someone: click Add User and enter their email
3. Assign a role: Owner, Manager, or Staff
4. Staff can access POS, inventory, and fulfillment — not pricing or settings
5. Save — the new user receives an invitation
6. To change a role: find the user and update their role, then save

### View the Audit Log
**Status:** Live

Reviewing a history of who did what and when — useful for reconciliation or troubleshooting.

1. Open the admin app and go to Manage → Audit Log
2. Filter by date range, user, or action type
3. Each entry shows who performed the action, what changed, and whether they were at the studio or a fair

---

## Contacts & Vendors

### Manage Contacts
**Status:** Live

Tracking the people and businesses Shir Glassworks works with — suppliers, galleries, event organizers, and more.

1. Open the admin app and go to Manage → Contacts
2. View all contacts in a searchable, filterable list
3. Filter by category: Supplier, Facilities, Gallery, Marketplace, Event Organizer, Partner, Student, Press, Other
4. Click "+ Add Contact" to create a new contact — enter name, category, email, phone, and notes
5. Optionally sync the new contact to Google Contacts (creates a record in the "Shir Glassworks" group)
6. Click a contact row to view their full detail and interaction history

### Log an Interaction
**Status:** Live

Recording a phone call, email, meeting, or other touchpoint with a contact so nothing falls through the cracks.

1. Open a contact's detail view (Manage → Contacts → click the contact)
2. Click "Log Interaction"
3. Select the interaction type: Call, Email, Meeting, Site Visit, Payment, Signed Document, or Other
4. Enter the date and who logged it (Ori or Madeline)
5. Add notes describing what happened
6. Optionally attach a Google Drive document link — the app fetches the file metadata automatically
7. Save — the interaction appears in the contact's timeline, most recent first

### Sync Contacts from Google
**Status:** Live

Pulling in contacts that were added directly to the "Shir Glassworks" group in Google Contacts, so they appear in the admin app too.

1. Open the admin app and go to Manage → Contacts
2. Click the "Sync Google" button
3. Grant Google Contacts access if prompted (one-time per session)
4. The app checks the "Shir Glassworks" contact group in Google Contacts
5. Any contacts in that group that don't exist in Firebase are created automatically
6. Existing contacts are not overwritten — sync only adds new ones

---

## Not Yet Built

The following workflows have been identified but not yet designed or built. These are candidates for the next planning session with Ori and Madeline.

| Workflow | Notes |
|---|---|
| Forecasting — What to Build Next | View demand vs. inventory to plan the next production run. Data model is designed, UI not started. |
| Promo Photo Shoot | Guided lightbox shoot for website and Etsy photos. Studio Companion currently handles Vision training only. |
| Etsy / Wholesale Order Management | Handling orders from channels outside the website. Not yet designed. |
| Customer Follow-Up | Sending updates or follow-up messages to buyers. Not yet designed. |
| End-of-Year Financials Summary | Pulling together sales, costs, and reconciliation. Not yet designed. |
| Contact History Import | Retroactive import of existing Google Drive documents into contact interaction timelines. Deferred pending proof of value from Phase 1. |
