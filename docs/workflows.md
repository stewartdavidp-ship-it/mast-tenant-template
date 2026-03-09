---
# Shir Glassworks — Workflow Reference

A living document tracking all key workflows in the Shir Glassworks business app.
Updated by Claude Code as builds complete.

**Status values:**
- `Live` — built and available today
- `In Progress` — currently being built
- `Planned` — designed but not yet started
- `Not Started` — identified but not yet designed

**Navigation sections:** Dashboard → Make → Market → Sell → Ship → Teach → Manage

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
3. Customer enters their shipping address (pre-filled if logged in)
4. Address is validated automatically — customer corrects it if needed
5. Shipping cost is calculated and shown (free for orders over $100)
6. Customer reviews the order total including shipping
7. Customer enters payment details via Square's secure checkout
8. Payment is processed — customer sees an order confirmation
9. Order appears in the admin app under Sell → Retail Orders

---

## Order Fulfillment

### Confirm and Triage a New Order
**Status:** Live

When a new order comes in, the admin triages it — checking inventory and deciding whether items ship from stock or need to be built.

1. Open the admin app and go to Sell → Retail Orders
2. Find the new order (status: Placed) — a badge on "Retail Orders" in the sidebar shows the count of placed orders
3. Review the order details — items, options, shipping address
4. Each item shows its inventory status inline: In Stock, Low Stock, Not in Stock, or Made to Order
5. Click "Confirm Order" — the Triage Dialog opens
6. The dialog shows each item with available stock and a pre-selected action: "From Stock" or "Send to Build"
7. Override any item's action if needed (e.g., force build even if in stock)
8. Review the summary: how many items from stock vs. build, and what status the order will advance to
9. Click "Confirm & Route" — inventory is reserved for stock items, production requests are created for build items
10. If all items are from stock: order advances to Ready
11. If any items need building: order advances to Building — a linked production request appears in Make → Jobs

### Pack and Ship an Order
**Status:** Live

What happens after an order is confirmed — from packing through to drop-off at the post office.

1. Open the admin app and go to Ship → Pack
2. The Pack Queue shows orders at Ready, Packing, and Packed status — each with a progress bar showing where it is in the pipeline
3. For a Ready order: click "Start Packing" to move it to Packing status
4. Pack the order — optionally use the Studio Scan tab to scan QR labels
5. Click "Mark Packed" on the order in the Pack Queue
6. Click "Pirate Ship →" — the CSV is automatically downloaded (first time) and Pirate Ship opens in a new tab
7. First-time users see a mapping guide dialog explaining which CSV fields need manual mapping in Pirate Ship (Weight, Dimensions, Order ID, Rubber Stamp) — Pirate Ship remembers mappings after the first time
8. In Pirate Ship: import the CSV, purchase the shipping label, print and attach it to the package
9. Back in the Pack Queue: click "Handed to Carrier" on the packed order
10. Go to Ship → Ship → Drop-off to scan packages and bundle them for carrier pickup
11. Confirm drop-off — carrier and location are recorded
12. The order auto-transitions to Shipped and the customer receives an email notification with tracking info (if available)

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
7. Use the gear button in the top bar at any time to switch events, unlink, or link to a different active event
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

1. Open the admin app and go to Make → Jobs
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

1. Open the admin app and go to Make → Jobs
2. Find the job and open it
3. While the job is in progress, update completed and loss quantities inline on each line item — changes save automatically
4. Review the finished quantities before completing — adjust if any pieces didn't turn out
5. Mark the job as Complete
6. Inventory is updated automatically — each line item's completed quantity (minus losses) is added to stock
7. A confirmation toast shows how many products were updated
8. Pieces are now available for sale online and at events

---

## Forecasting

### Forecasting — What to Build Next
**Status:** Live

Use the Forecast view to see what's selling, what's running low, and what to build next — all in one place.

1. Open the admin app and go to Make → Jobs
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

## Inventory

### Update Stock After a Firing
**Status:** Live

A quick way to update inventory counts after pieces come out of the kiln, without going through a full production job.

1. Open the admin app and go to Manage → Inventory
2. Find the product you're updating and click Adjust Stock
3. Choose a mode: **Set Count** (enter an absolute number) or **Add Pieces** (enter how many to add to current stock)
4. Save — the updated count is immediately reflected in the shop

### Move Inventory Between Locations
**Status:** Live

Tracking where pieces are stored — studio shelves, display cases, fair bins — so you always know where to find something.

1. Open the admin app and go to Manage → Inventory
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
5. To use on the website: assign the image to the relevant section in Manage → Website Content

---

## Coupons

### Create and Manage Coupons
**Status:** Live

Creating discount codes for customers — percentage or fixed-amount, with optional minimum order, usage limits, and date ranges.

1. Open the admin app and go to Sell → Coupons
2. Click "+ New Coupon"
3. Enter the coupon code (e.g. "SPRING25")
4. Choose the discount type: Percentage or Fixed Amount
5. Set the discount value (e.g. 25% or $10)
6. Optionally set: start/end dates, minimum order amount, maximum uses, and one-per-customer flag
7. Add an optional description for internal reference
8. Save — the coupon is active and can be used at checkout
9. The coupons list shows status (Active, Pending, Expired) auto-calculated from dates and usage

---

## Sculptures & Commissions

### Add a New Sculpture
**Status:** Live

Bringing a one-of-a-kind sculpture into the system so it can be listed on the website and tracked separately from production pieces.

1. Create the product in the usual way (Studio Companion or manually in admin)
2. In the admin app, go to Manage → Products and open the product
3. Set the Business Line to **Sculpture**
4. Set price, add photos, and toggle to Published
5. In Manage → Inventory, set the stock to 1
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
7. If the customer agrees: update status to **Accepted** and click **Create Production Job** — a linked job appears in Make → Jobs
8. Build the piece and mark the production job as complete — update commission status to **Built**
9. Ship or hand off the piece, then mark the commission as **Completed**
10. If the customer declines: update status to **Declined**

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
9. Later, if the post performs well, tap the thumbs-up or fire icon on the post in your Posted History to log the signal

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

### Compose and Publish a Newsletter Issue
**Status:** Live

How to create a newsletter issue in Studio — from blank template to published blog post or HTML export for email.

1. Open the admin app and go to Market → Blog & Newsletter
2. Click "+ New Issue" — a new draft is created with 7 default sections pre-populated
3. Enter the issue title at the top of the compose screen
4. Expand each section and write your content in the text area (each has a guided prompt to help)
5. Optionally click "Polish with AI" to get a cleaned-up version — compare side-by-side and pick your preferred version
6. Add images from the Studio image library to any section (optional)
7. Toggle off any sections you want to skip for this issue
8. To send via email: click "Export HTML" — downloads a styled email file ready for your email tool
9. To publish on the website: click "Publish to Website" — the issue appears on shirglassworks.com/blog
10. After sending the email externally, click "Mark as Sent" to record the send date and subscriber count

### Manage Newsletter Subscribers
**Status:** Live

Adding, removing, and exporting the mailing list for the Shir Glassworks newsletter.

1. Open the admin app and go to Market → Blog & Newsletter
2. Click the "Subscribers" tab
3. View all active subscribers — name, email, source (Website or Manual), and date
4. To add someone manually: click "+ Add Subscriber" and enter their name and email
5. To remove someone: click "Remove" on their row — they're marked as unsubscribed (not deleted)
6. To export the list for an email tool: click "Export CSV" — downloads a CSV with name, email, and subscribe date
7. Customers can also sign up via the newsletter form on the website footer — those appear with a "Website" source badge
8. Customers can unsubscribe via the link in newsletter emails — their status updates automatically

### Create and Curate a Product Story
**Status:** Live

Building a "How It Was Made" story for a product — linking production photos from a build job into a narrative that shows on the product page.

1. Open the admin app and go to Market → Stories
2. If a completed job has no story yet, a "Missing Stories" prompt appears at the top — click "Create Story" on any job
3. Alternatively, open a job detail in Make → Jobs and click "Create Story"
4. In the story editor: enter a title and select photos from the build's media library
5. For each selected photo, add a milestone label (e.g. "Gather", "Shaping", "Annealing") and a caption
6. Reorder entries by dragging, or remove entries you don't want
7. Click "Save Draft" to save without publishing, or "Publish" to go live
8. On publish: the story is linked to all products from that job, and QR codes are automatically generated for each linked product
9. The story appears as a "How It Was Made" section on each linked product's page

### View and Manage Published Stories
**Status:** Live

Reviewing, editing, and managing stories from the Stories list view.

1. Open the admin app and go to Market → Stories
2. Browse all stories — filter by Draft or Published status
3. Click a story to see its full detail: entries, linked products, artists, and QR codes
4. To edit: click "Edit Story" to re-enter the curation editor
5. To unpublish: click "Unpublish" — the story is removed from product pages but kept as a draft
6. Published stories show QR codes for each linked product — use "Print QR" to print a label or "Copy URL" to share the product page link

---

## Contacts & Relationships

### Add a New Contact
**Status:** Live

Bringing a vendor, partner, gallery, or other business contact into the system so interactions can be tracked over time.

1. Open the admin app and go to Manage → Contacts
2. Click "+ Add Contact"
3. Enter the contact name, category (Supplier, Facilities, Gallery, Marketplace, Event Organizer, Partner, Student, Press, or Other), and optional notes
4. Optionally paste a Google Drive folder link for document access
5. Save — the contact is created in Studio and synced to Google Contacts automatically
6. A "Shir Glassworks" group is created in Google Contacts if it doesn't exist, and the contact is added to it

### Log an Interaction with a Contact
**Status:** Live

Recording a call, meeting, payment, or other touchpoint so there's a full history of the relationship.

1. Open the admin app and go to Manage → Contacts
2. Find the contact and open their record
3. Click "Log Interaction"
4. Select the interaction type: Call, Email, Meeting, Site Visit, Payment, Signed Doc, or Other
5. Set the date (defaults to today) and add notes on what happened
6. Optionally attach a document — paste a Google Drive link to attach file metadata to the interaction
7. Save — the interaction appears in the contact's timeline, newest first

### Sync Contacts from Google
**Status:** Live

Pulling in contacts that were added directly to the "Shir Glassworks" group in Google Contacts, rather than through Studio.

1. Open the admin app and go to Manage → Contacts
2. Click "Sync Google"
3. Grant Google Contacts access if prompted (one-time per session)
4. The app checks the "Shir Glassworks" group in Google Contacts (creates the group automatically if it doesn't exist)
5. Any contacts in that group that don't exist in Firebase are created automatically with category set to "Other"
6. Existing contacts are not overwritten — sync only adds new ones
7. Update the category on imported contacts as needed

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
7. Managers can access POS, inventory, and packing — not pricing, settings, or user management
8. Staff have basic access to POS and inventory

### View Analytics
**Status:** Live

Reviewing website traffic, page views, and visitor activity over time.

1. Open the admin app and go to Manage → Analytics
2. Select a time range: Last 7 days, Last 30 days, or Last 90 days
3. Review the summary cards for key metrics
4. Click Refresh to pull the latest data

### View the Audit Log
**Status:** Live

Reviewing a history of who did what and when — useful for reconciliation or troubleshooting.

1. Open the admin app and go to Manage → Audit Log
2. Filter by date range, user, or action type
3. Each entry shows who performed the action, what changed, and whether they were in fair mode or studio mode

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
| Ship Bundles | Creating and managing carrier bundles for batch drop-offs. Ship → Ship → Bundles. |
