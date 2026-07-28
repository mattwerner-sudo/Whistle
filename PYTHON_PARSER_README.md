# Python Directory Parser

A robust Python script for extracting contact information (first name, last name, title, email, phone) from staff directory web pages.

## Features

✅ **Smart Name Extraction**
- Extracts from headings, bold text, and table cells
- Falls back to parsing email addresses when name not found
- Handles various name formats

✅ **Intelligent Container Detection**
- Finds the most specific HTML container for each contact
- Prevents mixing data from multiple contacts
- Supports tables, lists, cards, and custom layouts

✅ **Multi-Strategy Title Extraction**
- Checks for `.title`, `.position`, `.role` classes
- Parses table columns
- Extracts from nearby text elements

✅ **Phone Number Detection**
- US phone number pattern matching
- Handles various formats: (555) 123-4567, 555-123-4567, etc.

## Installation

### 1. Install Python Dependencies

```bash
pip install beautifulsoup4 requests lxml
```

Or using the versions tested with this script:

```bash
pip install beautifulsoup4==4.12.2 requests==2.31.0 lxml==4.9.3
```

### 2. Make Script Executable (Optional)

```bash
chmod +x directory_parser.py
```

## Usage

### Parse a URL

```bash
python directory_parser.py https://example.com/staff-directory
```

### Parse a Local HTML File

```bash
python directory_parser.py staff_directory.html
```

## Output

The script will:
1. Display all contacts in a formatted table
2. Export results to `contacts.csv`

### Example Output

```
Found 4 contacts:

First Name      Last Name       Title                          Email                          Phone          
--------------------------------------------------------------------------------------------------------------
Sarah           Johnson         Marketing Director             sarah.johnson@company.com      (555) 111-2222 
Michael         Chen            Operations Manager             michael.chen@company.com       (555) 333-4444 
Robert          Williams        Senior Software Engineer       robert.williams@company.com    (555) 555-6666 
Jessica         Taylor          Chief Technology Officer       jessica.taylor@company.com     (555) 777-8888 

✓ Exported 4 contacts to contacts.csv
```

## How It Works

### 1. Container Detection
The parser uses a multi-level strategy to find the correct HTML container for each contact:

```python
# Priority order:
1. <tr> (table rows)
2. <li> (list items)
3. .contact-card, .card, .person, .employee classes
4. <article> tags
5. Smart DIV traversal (max 5 levels up)
```

### 2. Name Extraction
Tries multiple strategies in order:

```python
1. Headings (h1-h5)
2. Bold/strong text
3. Bio links with aria-labels
4. First table cell
5. Email address parsing (fallback)
```

**Email Parsing Example:**
- `michael.chen@company.com` → `Michael Chen`
- `j_smith123@example.org` → `J Smith`

### 3. Title Extraction
Checks for:
- Class names: `.title`, `.position`, `.role`, `.job-title`
- Second table column
- Paragraph/div text that doesn't contain email/phone/name
- Filters out non-title text

## Advantages Over JavaScript Parser

1. **BeautifulSoup Power**: More robust HTML parsing with better error handling
2. **Python Regex**: More powerful pattern matching capabilities
3. **Server-Side**: No CORS issues when fetching URLs
4. **Offline Processing**: Can process saved HTML files
5. **CSV Export**: Direct export to CSV format
6. **Easy Debugging**: Print statements and step-through debugging

## Customization

### Add Custom Container Classes

Edit the `find_contact_container()` function:

```python
for selector in ['tr', 'li', '.contact-card', '.your-custom-class', 'article']:
    # ...
```

### Adjust Name/Title Extraction

Modify `extract_name_from_container()` or `extract_title_from_container()` functions to add custom logic for your specific directory format.

### Change Phone Number Format

Update the regex in `extract_phone_from_text()`:

```python
# International format example
phone_pattern = r'\+?\d{1,3}[\s.-]?\(?\d{1,4}\)?[\s.-]?\d{1,4}[\s.-]?\d{1,9}'
```

## Troubleshooting

### No contacts found
- Check if the page uses JavaScript to load content (this script only parses static HTML)
- Verify email links use `mailto:` format
- Try saving the page HTML and inspecting the structure

### Incorrect names/titles
- Inspect the HTML structure of your specific directory
- Add custom class names to the container detection
- Adjust extraction priority in the functions

### CORS/Access Issues
- Some sites block automated access
- Try downloading the HTML first, then parse the file
- Use browser developer tools to save the rendered HTML

## Example: Testing with Sample HTML

Create a file `test.html`:

```html
<div class="staff-directory">
  <div class="contact-card">
    <h3>John Doe</h3>
    <p class="title">Software Engineer</p>
    <a href="mailto:john.doe@company.com">Email</a>
    <p>(555) 123-4567</p>
  </div>
</div>
```

Run:
```bash
python directory_parser.py test.html
```

## Integration with Current Web App

If you want to integrate this parser into your existing web application:

1. **Backend Endpoint**: Create a Python Flask/FastAPI endpoint
2. **Call from Node**: Use Python child process from Express
3. **Hybrid Approach**: Use this script for batch processing, keep web app for interactive use

## License

Free to use and modify for your needs.
