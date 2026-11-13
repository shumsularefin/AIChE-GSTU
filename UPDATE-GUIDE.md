# Chapter Editor guide

Open https://aiche-gstu.web.app/admin.html and choose **Sign in with Google** with the account the super-admin added. Allow pop-ups if the Google window does not appear.

## The two steps

1. **Edit** a section. Your changes are saved as a **draft in this browser** as you type ("Draft saved 12:03 · not live yet").
2. **Publish** that section. Each section publishes on its own, so one unfinished form never blocks another.

The orange **unpublished drafts** button at the top lists every draft by name, with Open, Discard and Publish. **Publish all** publishes them one by one. If one has a problem, its section opens with the message shown and the others still go live.

Visitors see published changes immediately. Search engines and link previews follow within about 15 minutes.

If someone else published the same section while you were editing, you are asked whether to keep your version or load theirs.

## Events

- **Events → + New event.** Give it a title, category, start date, and an **end date** for events that run over several days. Times are optional and use Bangladesh time.
- The **registration link is optional.** Set Registration to **Open** to show the "Explore new event & register" button on the homepage. It disappears by itself after the event ends.
- **Upload from device** adds a photo; it is resized and optimized automatically. **Choose uploaded image** reuses one. You never type file paths.
- **Choose uploaded image** opens the image library. Search by file name, event, person or month; **Show** narrows it to images used by events, team & members, the homepage and membership page, forms, unpublished drafts, or **Unused**; **Order** sorts newest or oldest first. Images are grouped by the month they were uploaded, and each one says where it is used.
- **Unused images are removed automatically after 30 days.** The clock starts the first day the dashboard sees an image unused and restarts if the image is used again (also in a draft). The library shows the removal date under each unused image; **Delete now** removes one earlier. The check runs when the super-admin opens the dashboard (at most once a day). An image kept only in another editor's draft stays safe as long as that editor opens the dashboard at least once a month.
- **Preview** shows the event page before publishing.
- Outreach editors can edit the events they added. Only a super-admin can delete events.
- Super-admins can import many events from a spreadsheet: each becomes a draft to review and publish.
- **Categories** match the sections of the annual report: **Service**, **Professional Development**, **Chapter Development** and **Sustainability**.

## Annual reports

By default the annual report year runs from 1 May of the year before to 31 May, the deadline. Check the dates and the questions against AIChE's current Student Chapter annual report each year (the questions are listed in `js/lib/annual-report.js`). Every editor can create the report from the published events:

1. **Annual reports → Fiscal year:** choose the year (the current one is selected, with the days left to the deadline). Events are included by their start date. **Adjust the reporting period** if AIChE uses different dates.
2. **Events in this report:** every event in the period, grouped into the four sections. Untick an event to leave it out, choose another section for this report only, or tick **Also list under Sustainability** to show it in both places. Events held in May also fall in the previous year's period; leave them out if they were already reported.
3. **Download PDF report:** the events of the year by section, each with its date, location, category and description, followed by the **self-assessment questions** (goals, service, professional development, chapter development, finances and sustainability) for the executives to answer. **Download Excel** gives the same events in a sheet for copying into AIChE's form.

**Copy for AI** copies one prompt with the year's events and all the questions, written for answers at the standard of an outstanding AIChE Student Chapter report. Paste it into Gemini, ChatGPT or Claude (free versions work). The AI writes [Chapter to provide: …] wherever it needs facts only the chapter knows (goals, budget, safety steps, succession plans) and lists them at the end. Fill those in and check every answer before submitting.

Your choices for each year are remembered in this browser. To change an event's title, date or description, edit the event and publish it; the report picks up the change.

## Sharing forms

Every published form has its own short address, for example `https://aiche-gstu.web.app/form-membership-2026.html`. Copy it from **Forms** (Copy link) and post it in WhatsApp or Messenger groups: it opens that form directly, and the link preview shows the form's title and description. New forms work at once; the preview appears after the next automatic rebuild (within about 15 minutes).

**QR code:** when a new form is published, its **Link & QR code** window opens by itself (it is also on every form and its Responses tab). The QR code opens the form's own page; **Download QR code (PNG)** gives a 1200 × 1200 image for posters and slides, and **QR code (SVG)** a vector file that stays sharp at any size.

## Homepage images and membership

- **Homepage images:** up to five slides. Reorder them with ↑ ↓, remove, upload or choose from the library, then Publish.
- **Membership information:** the Join & renew section on the homepage. Put one benefit per line.

## Team & rosters (super-admin)

- Choose **Founding members** or a year, or **+ Add year**.
- **Executive committee:** add members with a name, role and photo, reorder them, then Publish.
- **General & premium roster:** add members one at a time, or **Import members from a spreadsheet**:
  1. Download the template. It has two columns: Member Name and Membership ID. Type IDs as text to keep leading zeroes.
  2. Choose the file, then the worksheet if there is more than one, and the tier.
  3. Review: the wizard tells you how many members will be added and which will be updated (matched by membership ID).
  4. **Add to draft**, then Publish.
- Membership IDs are private. The Team page shows names and tiers only.

## Certificates

**Issue certificates** walks you through four steps:

1. **Category:** participation, champion, first or second runner-up, achievement, formal recognition (instructor, teacher, guest, delegate, institution, organization), or executive service. Your role decides which are available.
2. **Details:** only the fields that apply. Event certificates ask for the event. **Executive service asks for the fiscal year** (and optionally the office) and needs no event.
3. **Recipients:** one person, or a spreadsheet with Name and optional Membership ID, Designation and Achievement (download the template).
4. **Review & issue:** check the table and the preview, tick the confirmation, then **Issue**.

The category chooses the design: **Horizon** (white sheet with a navy panel) for participation and achievement, **Prestige** (navy and gold, with a placement ribbon and medal) for champion and runners-up, and **Heritage** (ivory, formal serif) for instructors, teachers, guests, delegates, institutions and executive service. Each shows the chapter logo, the advisors' signatures, the credential ID and a QR code.

When it finishes you get each recipient's link, a Copy link button, a PDF download, and a CSV of all links. Recipients with a membership ID can also find their certificate in the **Certificate Center** by choosing the event and entering their ID. Every certificate has its own credential ID and a QR code that opens its verification page.

- **Sharing a certificate:** on its verification page, recipients can **Download certificate PDF** or **Share certificate**: copy link, email, WhatsApp, LinkedIn post, or **Add to LinkedIn**, which opens LinkedIn's Licenses & Certifications form already filled in with the certificate name, issuer, issue date, credential ID and verification link.
- **Find or revoke:** look up a credential ID. Super-admins can revoke; the verification page then says "revoked".
- **Certificate Center list** (super-admin): hide test or temporary events from the public list.
- **Issued records** (super-admin): every certificate issued, with its status.

## Member Portal and attendance

The Member Portal is at `/portal.html` (the footer and the Chapter Editor menu link to it). It is separate from the Chapter Editor but uses the same Google sign-in.

**Two separate sets of roles.** Chapter Editor roles (super-admin, chapter administrator, outreach editor) cover the public website only and give no portal access. Portal roles are the four officers (President, Vice President, Secretary, Treasurer), who run the portal, and members. The President has the last word and can delete anything in the portal. Only the site owner's own account also has full portal access, so the portal can always be recovered.

**Adding executive members.** Under **Manage → Members**, any officer can add people by Google email, by hand or with **Upload Excel** (columns Name, Email, Membership ID, and optionally Year and Designation; **Download the Excel template** gives the layout). The first time they sign in with that email they get an active executive-member profile, with no claim or approval. Until then they are listed under *Added, not signed in yet*.

**Executive members.** In **Team & rosters**, every executive committee member of a year needs an **AIChE membership ID** and a **Google email** (private; the year cannot be published without them). Publishing the year creates their Member Portal profile automatically the first time they sign in with that email; nobody has to approve them. Members whose role is exactly *President*, *Vice President*, *Secretary* (or *General Secretary*) or *Treasurer* become portal admins. Remove someone from the committee and they lose their executive designation and admin rights the next time they sign in.

**Leaderboard.** Executive members see the leaderboard of the fiscal year (1 June to 31 May), ranked by points, then attendance. It updates whenever a reviewer accepts or rejects attendance, or opens **Rankings**.

**Tasks.** Under **Manage → Tasks**, a portal admin (President, Vice President, Secretary or Treasurer) creates a task (optionally for an event, picked from a list with the newest first, plus its own title) with points, a due date and a late deduction (a percentage of the points for each day late), and assigns it to members, or opens it for volunteers to request. Members hand in their work under **My tasks**; the admin approves it (the points are filled in with the deduction applied, and can be changed) or returns it for changes. Officers cannot approve their own work.

**Contribution claims.** Members can claim past work while claims are open: they pick the event from a list, or *Not an event* and describe it, then add a tag, date and proof link. Any portal admin opens or closes claims under **Manage → Contribution claims**; only the President or Secretary approves them with points.

**Notices and notifications.** Admins post notices that every member sees on their home page. Members get a notification when they are approved, given a task, or their work or claim is reviewed; the menu shows the unread count.

**Executive Member of the Month.** Only the President names one executive member a month under **Manage → Member of the Month**. This issues a verifiable *Executive Member of the Month* certificate (its own simple design; credential `EMOTM-YYYY-MM`) and shows the award on every member's home page. Deleting the award also deletes its certificate, and the month can then be awarded again.

**Deleting.** The President can delete members, attendance sessions (with their answers), single answers, tasks and people's work on them, contribution claims, notices and awards. Officers can delete tasks and notices.

**Members**

1. Sign in with Google and **link your membership**: full name, AIChE membership ID and membership year.
2. One board member approves the profile. The portal then shows **Attendance open now** and your own record.

**The board** (President, Vice President, Secretary, Treasurer) uses **Members**:

- Pending claims show whether the ID is on that year's roster, and whether another profile claims the same ID. **Approve**, **Edit** (name, ID, year, designation) or **Remove**; removed profiles can be restored.
- Only the **President** can give someone an officer role, change an officer's profile, or **Delete** a profile for good.
- **Export** downloads all profiles to Excel.

**Opening attendance (the four officers, in the portal):** open **Attendance** under *Manage*.

- Pick the event, a title (filled in as *Day 1*, *Day 2*, …) and how long it stays open (10 minutes to 6 hours), then press **Open attendance**. It opens at once.
- The verification question is optional. Without one, a member's attendance counts immediately. With one, the board reviews the answers.
- **+15 min** extends an open session and **Close now** ends it.
- While a session is open, the home page shows a **Mark attendance** button right after *Become a member*. The event page shows one too.
- Members sign in with Google and press one button; their name and membership ID come from their approved profile. Each member can answer only once per session.

**Reviewing (editors with the Administrator or Outreach role, and the board):** **Attendance review** lists the answers for a day, with a *Matches / Close / Differs* check against the expected answer and a flag for long answers copied word for word. Accept or reject one by one, or use **Accept all matching** (matching answers that are not copied) or **Accept all pending**. Accepted answers count as attended.

**Rankings** shows each active member's attendance rate for a year (or all years). **Download attendance (Excel)** gives a *Register* sheet: one row per member, Present/Absent for every session, then total sessions, attended, missed and attendance %. **Members** shows each member's attendance for the year. There is no fixed renewal threshold; the board and advisors decide.

## Your account, editors and backups

- **Your account & sign-in:** shows your role and exactly what you can do. Signing out keeps your drafts in this browser.
- **Manage editors & activity** (super-admin): add, change, disable or remove editors, and read the activity log: who changed what and when, with server times.
- **Backups** (super-admin): download all published content as JSON or Excel. It includes private IDs, so keep it safe. Restoring a backup loads it into drafts for review.

## Sorting lists

Every list that keeps growing (events, news, certificates, forms and responses, images, members, tasks, claims, notices, sessions and so on) shows a **Sort** dropdown once it has three or more items: newest or oldest first (or as listed / reverse when the list has no dates), and A to Z or Z to A. Each browser remembers the choice for each list. New lists in the Chapter Editor and the Member Portal get the dropdown automatically. To keep a list in a fixed order, give it the `data-nosort` attribute.
