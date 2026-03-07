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
**Status:** Live

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
8. Open Pirate Ship (ship.pirateship.com) and import the CSV — the admin app has a direct link next to the CSV button
9. Purchase the shipping label in Pirate Ship
10. Print the label and attach it to the package
11. Return to the admin app and scan packages at drop-off to bundle them
12. Confirm drop-off — carrier and location are recorded
13. The order auto-transitions to Shipped and the customer receives an email notification with tracking info (if available)

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
3. For any sales taken offline or outside the POS: click + Manual Sale, pick the product from your event allocations, enter the quantity, amount, and payment type, then save
4. The manual sale is recorded, the event allocation sold count is updated, and inventory is decremented automatically
5. When reconciliation is complete, click Close Event
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
6. Save the job — it appears in the Jobs list
7. As work progresses, update the status: In Progress → Ready

> **Note:** The Queue tab shows production requests generated automatically from online orders — these are separate from manually created jobs.

### Complete a Production Run and Update Inventory
**Status:** Live

Closing out a build job once the pieces are finished and ready for sale.

1. Open the admin app and go to Make → Production → Jobs
2. Find the job and open it
3. While the job is in progress, update completed and loss quantities inline on each line item — changes save automatically
4. Review the finished quantities before completing — adjust if any pieces didn't turn out
5. Mark the job as Complete
6. Inventory is updated automatically — each line item's completed quantity (minus losses) is added to stock
7. A confirmation toast shows how many products were updated
8. Pieces are now available for sale online and at events

---

## Inventory

### Update Stock After a Firing
**Status:** Live

A quick way to update inventory counts after pieces come out of the kiln, without going through a full production job.

1. Open the admin app and go to Make → Production → Inventory
2. Find the product you're updating and click Adjust Stock
3. Choose a mode: **Set Count** (enter an absolute number) or **Add Pieces** (enter how many to add to current stock)
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
4. Optionally paste their Google Drive folder link for document access (Studio won't create a folder automatically — paste a link to an existing folder)
5. Save — the contact is created in Studio and synced to Google Contacts automatically
6. A "Shir Glassworks" label is added to the contact in Google Contacts

### Log an Interaction with a Contact
**Status:** Live

Recording a call, meeting, payment, or other touchpoint so there's a full history of the relationship.

1. Open the admin app and go to Manage → Contacts
2. Find the contact and open their record
3. Click Log Interaction
4. Set the date (defaults to today), type (Call, Email, Meeting, etc.), and add notes on what happened
5. Optionally attach a document — paste a Google Drive link to attach file metadata to the interaction
6. Save — the interaction appears in the contact's timeline, newest first

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
2. To invite someone: click + Add User in the section header
3. Enter their email address and select a role: Owner, Manager, or Staff
4. Click Send Invite — the invite is recorded and you'll see it as a pending row in the users list
5. Tell the person to sign in with their Google account — they'll be assigned the invited role automatically on first login
6. To change an existing user's role: use the role dropdown next to their name in the users list
7. Managers can access POS, inventory, and fulfillment — not pricing, settings, or user management
8. Staff have basic access to POS and inventory

### View the Audit Log
**Status:** Live

Reviewing a history of who did what and when — useful for reconciliation or troubleshooting.

1. Open the admin app and go to Manage → Audit Log
2. Filter by date range, user, or action type
3. Each entry shows who performed the action, what changed, and whether they were in fair mode or studio mode

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

## Sculptures & Commissions

### Add a New Sculpture
**Status:** Live

Bringing a one-of-a-kind sculpture into the system so it can be listed on the website and tracked separately from production pieces.

1. Create the product in the usual way (Studio Companion → Identify & Train, or manually in admin)
2. In the admin app, go to Manage → Products and open the product
3. Set the Business Line to **Sculpture**
4. Set price, add photos, and toggle to Published
5. In Make → Production → Inventory, set the stock to 1
6. The product now appears in the shop — sculptures are limited to 1 unit in stock
7. When the sculpture sells (POS or website), stock goes to 0 and the product is automatically marked **Sold**
8. On the website, sold sculptures remain visible with a "Sold" badge and a "Request a Commission" link

### Request a Custom Commission (Customer)
**Status:** Live

How a customer requests a custom piece — either from the dedicated commission page or from a sold sculpture's product page.

1. Customer navigates to the Commissions page (linked in the site nav on every page) or clicks "Request a Commission" on a sold sculpture's product page
2. Browse the product catalog and select pieces for inspiration (optional)
3. Upload a reference image showing what they have in mind (optional, max 5MB)
4. Enter their name, email or phone, and a description of what they're looking for
5. Submit the inquiry — a confirmation message appears
6. The studio receives a notification email with the customer's details and a QR code linking to the commission record

### Respond to a Commission Inquiry
**Status:** Live

Handling a customer request for a custom or commission piece — from initial inquiry through to delivery.

1. A notification email arrives with a QR code when a new inquiry comes in (from the website or POS)
2. Scan the QR code or open the admin app → Sell → Commissions
3. Review the inquiry: inspiration pieces the customer selected, any reference image they uploaded, their notes, and contact info
4. Update the status to **In Discussion** and start the conversation
5. Fill in the Proposal section: price, estimated timeline, and design/spec notes
6. Click **Send Proposal to Customer** — the customer receives an email with the proposal details and a QR code linking back to the commission
7. If the customer agrees: update status to **Accepted** and click **Create Production Job** — a linked job appears in Make → Production
8. Build the piece and mark the production job as complete — update commission status to **Built**
9. Ship or hand off the piece, then mark the commission as **Completed**
10. If the customer declines: update status to **Declined**

---

## Forecasting

### Forecasting — What to Build Next
**Status:** Live

Use the Forecast view to see what's selling, what's running low, and what to build next — all in one place.

1. Open the admin app and go to Make → Production
2. Click the Forecast tab (Owner and Manager only — Staff cannot see this tab)
3. If there are upcoming events within 60 days, a banner appears at the top — click it to review the event
4. The Suggested Builds section shows cards for products that are selling faster than current stock
5. Each card shows current stock, monthly sales rate, and weeks of coverage remaining
6. Click Create Job on a card to open a pre-filled production job with the suggested quantity
7. Below stocked products, any Made-to-Order products with high demand (10+ orders in 90 days) appear under "Consider Stocking"
8. The Demand Overview table shows all production products with order history — sortable by any column
9. Use the time horizon toggle (Adaptive / 30d / 90d / All) to change the Sold column display
10. Click any row to jump to the product detail
11. The Slow/No Movement section (collapsed by default) lists products with stock but no recent orders

---

## Market

### Create and Post a Social Media Video
**Status:** Live

How to take a finished video from your camera roll to a ready-to-post Instagram Reel in Studio.

1. Open the admin app and go to Market → Social Media
2. Tap "New Post"
3. Choose "I already have a clip" and pick your edited video from your camera roll
4. In the Enhancement dialog: link to a product or event (or describe the video), choose a content style (treatment), and select Instagram Reels as the destination
5. Review the Clip Readiness score — proceed even if amber (it's advisory only)
6. Review the 3 caption variants and tap the one that fits best — edit inline if needed
7. Follow the Instagram Posting Guide steps A–E: Open Instagram, select your video, paste the caption, paste hashtags, set your cover frame
8. Back in Studio, tap "Mark as Posted" to record it
9. Later, if the post performs well, tap 👍 or 🔥 on the post in your Posted History to log the signal

### Pre-Shoot: Get a Shoot Card Before You Film
**Status:** Live

Use Studio to get specific shooting guidance before you pick up your camera.

1. Open Market → Social Media and tap "New Post"
2. Choose "I'm about to shoot"
3. Select a content style (treatment) and link to the product or event you're about to film
4. Studio generates a Shoot Card — 4–6 specific instructions for your exact subject and style
5. Read the card, then tap "Ready to Shoot" and open your camera app
6. When you return with the edited video, go back to Studio → New Post → "I already have a clip"
7. The pending post record is waiting — upload your clip and continue from Step 4 in the workflow above

### Write and Send a Newsletter Issue
**Status:** Planned

How to compose, polish, and export a newsletter issue using Studio's section-based editor with optional AI assistance.

1. Open the admin app and go to Market → Newsletter
2. Tap "New Issue" — Studio creates a new issue with 7 default sections and assigns it an issue number
3. Enter a title for the issue (e.g. "March Studio Update" or "Fair Season Preview")
4. Work through each section — tap a section card to expand it:
   - Read the guided prompt (e.g. "What happened at the most recent show?")
   - Write your response in the text area — you can ignore the prompt and write freely
   - Tap "Polish with AI" if you'd like Studio to clean up grammar and flow — a side-by-side view shows your original and the polished version, pick one
   - Add up to 3 photos from your image library to the section (optional)
   - Toggle "Include in issue" off to skip a section with nothing to say
5. To add a section not in the default template, tap "Add Section" at the bottom
6. To reorder sections, use the drag handles
7. When the issue looks ready, tap "Export HTML" — Studio downloads a formatted HTML file you can upload to your email platform (Mailchimp, Klaviyo, etc.)
8. Tap "Publish to Website" to make the issue live on shirglassworks.com/blog
9. After sending via your email tool, tap "Mark as Sent" in Studio to close the loop

### Manage Newsletter Subscribers
**Status:** Planned

Adding subscribers, reviewing the list, and exporting for use in your email platform.

1. Open Market → Newsletter → Subscribers
2. The list shows all subscribers: name, email, source (website sign-up or manual), date added, and status
3. To add someone manually: tap "Add Subscriber", enter their name, email, and an optional note (e.g. "met at Portland fair"), then save
4. To remove someone: tap the row and select Remove — they're marked unsubscribed but not deleted
5. To export the active list for upload to your email platform: tap "Export CSV"
6. Customers can also subscribe themselves via the sign-up form on the shirglassworks.com website — new sign-ups appear in the list automatically

---

## Not Yet Built

The following workflows have been identified but not yet designed or built. These are candidates for the next planning session with Ori and Madeline.

| Workflow | Notes |
|---|---|
| Promo Photo Shoot | Guided lightbox shoot for website and Etsy photos. Studio Companion currently handles Vision training only. |
| Etsy / Wholesale Order Management | Handling orders from channels outside the website. Not yet designed. |
| Customer Follow-Up | Sending updates or follow-up messages to buyers. Not yet designed. |
| End-of-Year Financials Summary | Pulling together sales, costs, and reconciliation. Not yet designed. |
| Contact History Import | Retroactive import of existing Google Drive documents into contact interaction timelines. Deferred pending proof of value from Phase 1. |