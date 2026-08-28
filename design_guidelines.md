# Design Guidelines: Collegiate Athletics Staff Data Platform

## Design Approach
**Reference-Based Approach** inspired by **HubSpot's CRM aesthetic** - clean, professional data platform with generous whitespace, card-based layouts, and crisp enterprise UI. Drawing from modern B2B SaaS patterns (ZoomInfo, LinkedIn Sales Navigator) for data-rich interfaces.

## Core Design Principles
- **Professional Clarity**: Enterprise-grade interface for athletics administrators
- **Generous Breathing Room**: Whitespace creates visual hierarchy and reduces cognitive load
- **Data-First Design**: Information presentation without overwhelming density
- **Intuitive Navigation**: Clear paths through school browsing and staff extraction workflows

## Typography
- **Primary Font**: Inter via Google Fonts CDN
- **Headings**: 
  - H1: text-3xl (30px), font-semibold for page titles
  - H2: text-2xl (24px), font-semibold for section headers
  - H3: text-xl (20px), font-medium for card headers
- **Body Text**: text-base (16px), font-normal for content, text-sm (14px) for metadata
- **Data Elements**: font-mono for emails, phone numbers, structured data

## Layout System
**Spacing Units**: Tailwind units 4, 6, 8, 12, 16, 20, 24
- Cards: p-6 to p-8 (generous internal padding)
- Section spacing: space-y-8 to space-y-12
- Container: max-w-7xl mx-auto px-6
- Grid gaps: gap-6 for card grids

**Grid Patterns**:
- School cards: grid-cols-1 md:grid-cols-2 lg:grid-cols-3
- Staff listings: Single-column cards with internal grid structure
- Dashboard widgets: grid-cols-1 lg:grid-cols-2 for metrics

## Component Library

### Navigation Header
- Full-width with subtle bottom border
- Logo left, primary nav center (Browse Schools | Extract Data | Saved Lists)
- User profile/settings right
- Height: py-5, sticky positioning
- Search bar integrated into nav for schools/staff search

### Tab Navigation (Sub-navigation)
- Horizontal tabs below header for section switching
- Active tab: Bottom border accent (thicker, purple)
- Inactive: Subtle hover state with border preview
- Spacing: px-6 py-3 per tab

### School Directory Cards
- White background with subtle border, rounded-xl
- School logo/badge top-left
- School name (text-lg font-semibold)
- Conference badge, location, division metadata
- Staff count indicator
- "View Staff" CTA button bottom-right
- Hover: Subtle shadow elevation, border emphasis

### Staff Data Table/Cards
- Card container for entire table section
- Header row: Sticky, subtle background, font-medium
- Data rows: Generous py-4 padding, border-b separator
- Columns: Name | Title | Email | Phone | Actions
- Avatar placeholders for staff photos
- Action buttons: Icon-only with tooltips (email, export, save)

### Data Extraction Panel
- Right sidebar drawer (slides in) or centered modal
- Input sections in cards with labels
- URL input with validation indicator
- "Extract Data" primary button
- Progress indicator during scraping
- Results preview before adding to workspace

### Search & Filters
- Prominent search bar with icon prefix
- Filter chips below search (Conference, Division, State)
- Active filters: Removable pills with X icon
- Filter dropdown panels with checkboxes

### Empty States
- Centered illustration placeholder
- Large heading: "No schools selected"
- Supporting text with suggested action
- Primary CTA button to browse schools

### Buttons
- Primary: Rounded-lg, px-6 py-3, font-medium
- Secondary: Border variant with same padding
- Icon buttons: p-2, rounded-lg
- Hover: Subtle transform scale(1.02) transition
- Disabled: Reduced opacity, no pointer events

### Metric Cards (Dashboard)
- Grid layout for KPIs
- Large number display (text-4xl)
- Label below (text-sm)
- Icon or trend indicator
- Subtle background differentiation

### Modal Dialogs
- Backdrop with blur
- Max-width: max-w-3xl
- Rounded-2xl corners
- Header: Title + description, close button
- Footer: Right-aligned actions with clear hierarchy
- Padding: p-8

## Icons
**Heroicons** (outline for UI, solid for filled states) via CDN:
- AcademicCapIcon (schools)
- UsersIcon (staff)
- MagnifyingGlassIcon (search)
- FunnelIcon (filters)
- EnvelopeIcon, PhoneIcon (contact)
- ArrowDownTrayIcon (export)
- BookmarkIcon (save lists)

## Images
**No large hero image** - This is a dashboard/data application, not a marketing site. 
- School logos: Small badges (40x40px) in cards
- Staff avatars: Placeholder circles (48x48px) in tables
- Empty state illustrations: Centered, max 300px width

## Animations
**Minimal & Purposeful**:
- Card hover: Shadow transition (duration-200)
- Modal entrance: Fade + slight slide-up (duration-300)
- Tab switching: Content fade (duration-150)
- NO decorative animations, scroll effects, or motion beyond functional feedback

## Key UX Patterns
- **Persistent Context**: Breadcrumbs show navigation depth
- **Bulk Actions**: Multi-select checkboxes for staff records
- **Quick Actions**: Inline buttons in table rows
- **Smart Defaults**: Remember last-used filters/views
- **Export Flexibility**: CSV, Excel format options
- **Save Workflows**: Create custom school/staff lists

## Responsive Behavior
- **Desktop (lg+)**: Multi-column grids, side panels, full tables
- **Tablet (md)**: 2-column grids, stacked panels
- **Mobile**: Single column, bottom sheets for filters, simplified tables (cards)