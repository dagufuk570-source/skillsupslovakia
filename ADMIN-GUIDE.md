# SkillsUp Slovakia - Admin Panel User Guide

## Table of Contents
1. [Getting Started](#getting-started)
2. [Dashboard Overview](#dashboard-overview)
3. [Managing Themes](#managing-themes)
4. [Managing Events](#managing-events)
5. [Managing Team Members](#managing-team-members)
6. [Managing News](#managing-news)
7. [Managing Documents](#managing-documents)
8. [Managing Focus Areas](#managing-focus-areas)
9. [Settings](#settings)
10. [Managing Pages](#managing-pages)
11. [Multi-Language Content](#multi-language-content)
12. [Tips & Best Practices](#tips--best-practices)

---

## Getting Started

### Accessing the Admin Panel
1. Navigate to: `https://your-domain.com/admin` or `https://37.148.211.145/admin`
2. Enter credentials:
   - **Username:** `admin`
   - **Password:** `s3cret`
3. Click "Sign In" or press Enter

### Changing Admin Credentials
For security, change default credentials by updating the `.env` file on the server:
```bash
ADMIN_USER=your_username
ADMIN_PASS=your_secure_password
```
Then restart the application: `pm2 restart skillsupslovakia`

---

## Dashboard Overview

The dashboard provides quick access to all management sections:

### Sidebar Menu Structure
- **Dashboard** - Overview and quick stats
- **Themes** - Manage thematic project areas
- **Events** - Manage training events and workshops
- **Our Team** - Manage team member profiles
- **News** - Publish news articles and updates
- **Documents** - Manage downloadable files
- **Focus Areas** - Define organization's focus areas
- **Settings** - Configure slider, contact info, GDPR, stats
- **Pages** - Edit Home and About Us pages
- **View Site** - Preview the public website
- **Logout** - Sign out securely

### Language Indicator
The admin panel supports **3 languages**:
- 🇬🇧 English (en)
- 🇸🇰 Slovak (sk)
- 🇭🇺 Hungarian (hu)

Content can be managed separately for each language.

---

## Managing Themes

**Themes** represent major project areas or thematic focuses of your organization.

### Adding a New Theme

1. Click **Themes** in the sidebar
2. Click **"Add New Theme"** button
3. Fill in the form:

#### Form Fields:

**Title** (Required)
- The name of the theme
- Example: "Digital Skills Training"

**Description** (Required, WYSIWYG Editor)
- Detailed description of the theme
- Use the rich text editor to format:
  - **Bold**, *Italic*, Underline
  - Headings (H1, H2, H3)
  - Bullet lists and numbered lists
  - Links and images
  - Tables
  - Code view for advanced HTML

**Slug** (Optional)
- URL-friendly version of the title
- Auto-generated if left empty
- Example: "digital-skills-training"

**Status**
- **Published** - Visible on the website
- **Draft** - Hidden from public view

**Image Upload** (Optional)
- Click "Choose File" to upload a theme image
- Recommended size: 800x600px or larger
- Supported formats: JPG, PNG, GIF

**Additional Images** (Optional)
- Upload up to 4 supporting images
- Add captions/descriptions (alt text) for each
- Used in theme detail pages

4. Click **"Save Theme"** button

### Editing an Existing Theme

1. Click **Themes** in sidebar
2. Find the theme in the list
3. Click **"Edit"** button
4. Modify any fields
5. Click **"Update Theme"**

### Deleting a Theme

1. Click **Themes** in sidebar
2. Find the theme in the list
3. Click **"Delete"** button
4. Confirm deletion (this cannot be undone)

### Multi-Language Themes

Each language version is managed separately:
1. Create theme in English first
2. Switch language to Slovak (`?lang=sk`)
3. Create Slovak version with same title
4. Repeat for Hungarian (`?lang=hu`)

The system will link versions with matching titles automatically.

---

## Managing Events

**Events** include workshops, training sessions, conferences, and other activities.

### Adding a New Event

1. Click **Events** in sidebar
2. Click **"Add New Event"** button
3. Fill in the form:

#### Form Fields:

**Title** (Required)
- Event name
- Example: "Leadership Workshop 2025"

**Description** (Required, WYSIWYG Editor)
- Full event details
- Include: agenda, objectives, target audience
- Use formatting for better readability

**Slug** (Optional)
- Auto-generated URL-friendly version

**Event Date** (Optional)
- Select date from calendar picker
- Format: YYYY-MM-DD

**Location** (Optional)
- Venue name and address
- Example: "Bratislava Conference Center, Main Street 123"

**Registration Link** (Optional)
- External URL for event registration
- Example: "https://forms.google.com/your-form"

**Status**
- **Published** - Visible on events page
- **Draft** - Hidden from public

**Theme** (Optional)
- Select related theme from dropdown
- Links event to a thematic area

**Group ID** (Optional)
- Used to group multilingual versions
- Example: "workshop-2025"
- Same group ID for EN/SK/HU versions

**Image Upload** (Optional)
- Event banner/poster
- Recommended size: 1200x600px

**Additional Images** (Optional)
- Gallery images (up to 4)
- Add captions for context

4. Click **"Save Event"** button

### Event List Views

**All Events** - Complete list across all languages
**By Language** - Filter by EN, SK, or HU
**By Theme** - Filter events by thematic area

### Editing Events

1. Navigate to event in the list
2. Click **"Edit"**
3. Modify fields
4. Click **"Update Event"**

### Deleting Events

1. Find event in list
2. Click **"Delete"**
3. Confirm deletion

### Multi-Language Events

To create events in all languages:
1. Create event in English with a `group_id` (e.g., "workshop-2025")
2. Switch to Slovak: `?lang=sk`
3. Create Slovak version with **same group_id**
4. Switch to Hungarian: `?lang=hu`
5. Create Hungarian version with **same group_id**

The frontend will display the appropriate language based on visitor preference.

---

## Managing Team Members

Showcase your organization's team with profiles, photos, and contact info.

### Adding a Team Member

1. Click **Our Team** in sidebar
2. Click **"Add New Member"** button
3. Fill in the form:

#### Form Fields:

**Name** (Required)
- Full name of team member
- Example: "John Doe"

**Position** (Required)
- Job title or role
- Example: "Project Manager"

**Bio** (Required, WYSIWYG Editor)
- Professional biography
- Include: background, expertise, achievements

**Email** (Optional)
- Contact email address
- Displayed on team page

**Phone** (Optional)
- Contact phone number

**Social Links** (Optional)
- LinkedIn, Facebook, Twitter URLs

**Slug** (Optional)
- Auto-generated from name

**Status**
- **Published** - Visible on team page
- **Draft** - Hidden from public

**Profile Photo** (Optional)
- Professional headshot
- Recommended: 400x400px, square aspect ratio
- Formats: JPG, PNG

4. Click **"Save Member"** button

### Editing Team Members

1. Click **Our Team** → Find member
2. Click **"Edit"**
3. Update information
4. Click **"Update Member"**

### Deleting Team Members

1. Find member in list
2. Click **"Delete"**
3. Confirm removal

### Multi-Language Team Profiles

Create separate profiles for each language with translated bio and position.

---

## Managing News

Publish news articles, updates, and announcements.

### Adding a News Article

1. Click **News** in sidebar
2. Click **"Add New Article"** button
3. Fill in the form:

#### Form Fields:

**Title** (Required)
- Article headline
- Example: "New Partnership Announced"

**Content** (Required, WYSIWYG Editor)
- Full article text
- Use headings, lists, bold text for structure

**Excerpt** (Optional)
- Short summary (150-200 characters)
- Displayed on news listing page

**Slug** (Optional)
- Auto-generated from title

**Publication Date** (Optional)
- When article was published
- Format: YYYY-MM-DD

**Author** (Optional)
- Author name

**Status**
- **Published** - Live on website
- **Draft** - Not publicly visible

**Featured Image** (Optional)
- Article banner
- Recommended: 1200x630px (good for social sharing)

4. Click **"Save Article"** button

### Editing News Articles

1. Navigate to News list
2. Click **"Edit"** on article
3. Make changes
4. Click **"Update Article"**

### Deleting News Articles

1. Find article in list
2. Click **"Delete"**
3. Confirm deletion

### Multi-Language News

Create separate articles for each language. Visitors see news in their selected language.

---

## Managing Documents

Upload downloadable files (PDFs, reports, guidelines, etc.).

### Adding a Document

1. Click **Documents** in sidebar
2. Click **"Add New Document"** button
3. Fill in the form:

#### Form Fields:

**Title** (Required)
- Document name
- Example: "Annual Report 2024"

**Description** (Optional, WYSIWYG Editor)
- Document overview

**Category** (Optional)
- Group documents by type
- Examples: "Reports", "Guidelines", "Forms"

**File Upload** (Required)
- Click "Choose File"
- Supported formats: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX
- Max size: Check server settings (typically 10-50MB)

**Status**
- **Published** - Available for download
- **Draft** - Hidden

4. Click **"Save Document"** button

### Editing Documents

1. Go to Documents list
2. Click **"Edit"**
3. Update info or replace file
4. Click **"Update Document"**

### Deleting Documents

1. Find document
2. Click **"Delete"**
3. Confirm (file will be permanently removed)

---

## Managing Focus Areas

Define the core focus areas of your organization (4 recommended).

### Adding a Focus Area

1. Click **Focus Areas** in sidebar
2. Click **"Add New Focus Area"** button
3. Fill in the form:

#### Form Fields:

**Title** (Required)
- Focus area name
- Example: "Youth Empowerment"

**Description** (Required, WYSIWYG Editor)
- Detailed explanation

**Icon** (Optional)
- Font Awesome icon class
- Example: `fa-users` or `fa-graduation-cap`
- Browse icons: https://fontawesome.com/icons

**Status**
- **Active** - Displayed on homepage
- **Inactive** - Hidden

4. Click **"Save Focus Area"**

### Editing Focus Areas

1. Navigate to list
2. Click **"Edit"**
3. Modify content
4. Click **"Update"**

### Reordering Focus Areas

Focus areas are displayed in the order they were created. To reorder:
1. Delete and recreate in desired order, OR
2. Edit each and adjust creation timestamps in database

---

## Settings

Configure global website settings.

### Slider Settings

Control the homepage hero slider.

1. Click **Settings → Slider**
2. Configure:

**Enable Slider**
- Toggle ON/OFF

**Slides** (Up to 5)
For each slide:
- **Image**: Upload banner (recommended 1920x800px)
- **Title**: Main headline
- **Caption**: Subtitle/description
- **Button Text**: Call-to-action text (e.g., "Learn More")
- **Button Link**: URL destination
- **Active**: Show/hide this slide

**Slider Options:**
- **Background Image**: Overall slider background
- **Text Alignment**: Left, Center, or Right
- **Title Color**: Hex code (e.g., #FFFFFF)
- **Caption Color**: Hex code

3. Click **"Save Settings"**

### Contact Settings

Manage contact information displayed on Contact page.

1. Click **Settings → Contact**
2. Fill in:

**Address**
- Organization's physical address

**Email**
- General contact email

**Phone**
- Main phone number

**Contact Form Settings:**
- **Google reCAPTCHA**: Add site key and secret for spam protection

3. Click **"Save Contact Settings"**

### GDPR Settings

Edit privacy policy and data protection information.

1. Click **Settings → GDPR**
2. Use WYSIWYG editor to write policy
3. Include:
   - Data collection practices
   - User rights
   - Cookie policy
   - Contact info for privacy concerns
4. Click **"Save GDPR Policy"**

### Stats / Counters Settings

Display key metrics on homepage.

1. Click **Settings → Stats / Counters**
2. Add up to 4 statistics:

For each stat:
- **Value**: Number (e.g., 500)
- **Suffix**: Optional (e.g., "+", "K")
- **Label**: Description in each language
  - English label
  - Slovak label
  - Hungarian label
- **Icon**: Font Awesome class (e.g., `fa-users`)
- **Active**: Show/hide

Example:
- Value: 500
- Suffix: +
- Label (EN): "Students Trained"
- Label (SK): "Vyškolených študentov"
- Label (HU): "Képzett diákok"
- Icon: fa-graduation-cap

3. Click **"Save Stats"**

---

## Managing Pages

Edit static pages: Home and About Us.

### Editing Home Page

1. Click **Pages → Home**
2. Select language: `?lang=en`, `?lang=sk`, or `?lang=hu`
3. Edit:

**Main Content** (WYSIWYG)
- Homepage introduction text

**Additional Images** (Up to 4)
- Feature images with captions
- Used in special homepage sections

4. Click **"Update Page"**

### Editing About Us Page

1. Click **Pages → About Us**
2. Select language
3. Edit:

**Content**
- Organization history, mission, vision

**Additional Images** (Up to 4)
- Section images with captions
- Displayed in alternating layout

4. Click **"Update Page"**

---

## Multi-Language Content

The website supports **English, Slovak, and Hungarian**.

### Creating Multi-Language Content

**Step-by-step:**

1. **Create English Version First**
   - Always start with English (default language)
   - Fill all fields completely

2. **Create Slovak Version**
   - Add `?lang=sk` to URL
   - Create new item with **translated content**
   - Use same `group_id` (for events) or matching title

3. **Create Hungarian Version**
   - Add `?lang=hu` to URL
   - Create new item with **translated content**
   - Use same `group_id` or matching title

### Language Switching

Visitors can switch languages using the language selector in the website header. The admin panel respects this selection when displaying content.

### Translation Tips

- **Titles**: Translate naturally, don't use literal word-by-word translation
- **Descriptions**: Adapt cultural references for local audiences
- **Dates**: Use local date formats if applicable
- **Links**: Update external links to language-specific versions if available

---

## Tips & Best Practices

### Content Writing

1. **Be Clear and Concise**
   - Use simple language
   - Break text into short paragraphs
   - Use headings to structure content

2. **Use Visuals**
   - Include relevant images
   - Optimize images before upload (compress, resize)
   - Add descriptive alt text for accessibility

3. **SEO-Friendly**
   - Write descriptive titles (50-60 characters)
   - Create unique slugs
   - Use keywords naturally in content

### Image Guidelines

**Recommended Sizes:**
- **Slider images**: 1920x800px
- **Theme/Event banners**: 1200x600px
- **Team photos**: 400x400px (square)
- **News featured images**: 1200x630px

**Optimization:**
- Use JPG for photos (smaller file size)
- Use PNG for graphics with transparency
- Compress images before upload (use tools like TinyPNG)
- Max recommended size: 2MB per image

### Security

1. **Change Default Credentials**
   - Update admin username and password immediately

2. **Use Strong Passwords**
   - Minimum 12 characters
   - Mix of uppercase, lowercase, numbers, symbols

3. **Regular Backups**
   - Back up database regularly
   - Keep copies of uploaded files

4. **Keep Software Updated**
   - Update Node.js dependencies periodically
   - Monitor for security patches

### Performance

1. **Optimize Images**
   - Compress before upload
   - Use appropriate dimensions

2. **Limit Additional Images**
   - Use 2-4 images per item (not more)

3. **Clean Up Unused Content**
   - Delete old drafts
   - Remove unused images

### Content Strategy

1. **Regular Updates**
   - Publish news monthly
   - Update events calendar in advance
   - Keep team profiles current

2. **Quality over Quantity**
   - Publish well-written, valuable content
   - Proofread before publishing

3. **Engage Your Audience**
   - Include clear calls-to-action
   - Add registration links to events
   - Respond to contact form submissions

---

## Troubleshooting

### WYSIWYG Editor Not Loading

**Solution:**
1. Hard refresh page: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)
2. Clear browser cache
3. Try different browser (Chrome, Firefox, Edge)

### Images Not Uploading

**Possible causes:**
- File too large (reduce size below 5MB)
- Unsupported format (use JPG/PNG)
- Server storage full (contact administrator)

### Changes Not Appearing on Website

**Solution:**
1. Check item status is "Published" (not "Draft")
2. Clear browser cache
3. Check correct language version
4. Wait a few seconds and refresh

### Cannot Login

**Solution:**
1. Verify credentials (case-sensitive)
2. Check if cookies are enabled
3. Contact administrator to reset password

---

## Support

For technical support or questions:
- **Email**: info@skillsupslovakia.org
- **Server Access**: SSH to server for database/file management
- **Documentation**: Check README.md and README-db.md in project folder

---

## Quick Reference

### Most Common Tasks

| Task | Steps |
|------|-------|
| Add Event | Events → Add New → Fill form → Save |
| Add News | News → Add New → Fill form → Save |
| Edit Home Page | Pages → Home → Select language → Edit → Update |
| Upload Slider Image | Settings → Slider → Choose file → Save |
| Add Team Member | Our Team → Add New → Fill form → Save |
| Change Language | Add `?lang=sk` or `?lang=hu` to URL |

### Keyboard Shortcuts (WYSIWYG Editor)

- **Ctrl+B** / **Cmd+B** - Bold
- **Ctrl+I** / **Cmd+I** - Italic
- **Ctrl+U** / **Cmd+U** - Underline
- **Ctrl+K** / **Cmd+K** - Insert Link
- **Ctrl+Z** / **Cmd+Z** - Undo
- **Ctrl+Y** / **Cmd+Y** - Redo

---

**End of Admin Panel User Guide**

*Version 1.0 - October 2025*
*SkillsUp Slovakia - Empowering Communities Through Education*
