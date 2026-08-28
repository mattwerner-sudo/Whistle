# JavaScript-Rendered Page Scraping Setup

This guide provides solutions for extracting contact data from JavaScript-rendered websites like **rolltide.com**.

---

## 🎯 The Problem

Websites like rolltide.com use JavaScript to render content:
- ❌ Static HTML parsers see empty skeleton
- ❌ Python `requests` + BeautifulSoup fails
- ❌ CORS proxies return unrendered HTML

**Solution:** Use a headless browser (Playwright/Puppeteer) to execute JavaScript before parsing.

---

## 🚀 Option 1: Python Script with Playwright (RECOMMENDED)

### Installation

```bash
# Install Python dependencies
pip install playwright

# Install browser binaries (one-time setup)
playwright install chromium
```

### Usage

```bash
# Basic usage (headless mode)
python directory_parser_playwright.py https://rolltide.com/staff-directory

# Watch browser in action (visible mode)
python directory_parser_playwright.py https://rolltide.com/staff-directory --visible
```

### Output

```
Found 315 contacts:

First Name      Last Name       Title                          Email                          Phone          
--------------------------------------------------------------------------------------------------------------
Sarah           Lyons           Associate AD                   slyons@ua.edu                  (205) 348-6084
Jennifer        Pare            Director of Ops                jpare@ua.edu                   (205) 348-1234
Katie           Lee             Marketing Manager              klee@ua.edu                    (205) 348-5678
...

✓ Exported 315 contacts to contacts.csv
```

### Features

✅ **JavaScript Execution** - Sees fully-rendered content  
✅ **Smart Container Detection** - Finds individual contact blocks  
✅ **Multi-Strategy Extraction** - Headings, classes, data attributes  
✅ **Email Fallback** - Extracts names from emails when needed  
✅ **CSV Export** - Ready for import into spreadsheets  

### Pros & Cons

**Pros:**
- ✅ Works with ANY JavaScript-rendered site
- ✅ Standalone script - no web app changes needed
- ✅ Better debugging - can watch browser with `--visible`
- ✅ Industry-standard Playwright library
- ✅ Python's robust text processing

**Cons:**
- ⚠️ Requires separate Python environment
- ⚠️ ~300MB browser download (one-time)
- ⚠️ Slower (3-10 seconds vs instant parsing)

---

## 🔧 Option 2: Add Playwright to Node.js Backend

Integrate Playwright into your existing web application.

### Installation

```bash
npm install playwright
npx playwright install chromium
```

### Backend Implementation

Add to `server/routes.ts`:

```typescript
import { chromium } from 'playwright';

app.post("/api/fetch-url-js", async (req, res) => {
  const { url } = req.body;
  
  try {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000); // Let JavaScript render
    
    const html = await page.content(); // Get rendered HTML
    await browser.close();
    
    res.json({ html });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

### Frontend Changes

Update `client/src/pages/home.tsx`:

```typescript
// Add toggle for JavaScript rendering
const [renderJavaScript, setRenderJavaScript] = useState(false);

// In handleFetchUrl function:
const endpoint = renderJavaScript ? '/api/fetch-url-js' : '/api/fetch-url';
```

### Pros & Cons

**Pros:**
- ✅ Integrated into existing workflow
- ✅ User-friendly UI toggle
- ✅ No separate scripts needed

**Cons:**
- ⚠️ Increases backend complexity
- ⚠️ Requires ~300MB chromium download on server
- ⚠️ Higher resource usage (memory/CPU)
- ⚠️ Slower response times (3-10 seconds per request)

---

## 🌐 Option 3: Use Third-Party Rendering Service

Services that render JavaScript for you:

### ScrapingBee
```bash
# API call
https://app.scrapingbee.com/api/v1/?api_key=YOUR_KEY&url=https://rolltide.com/staff-directory&render_js=true
```

### BrowserCat
```bash
# Playwright API as a service
const browser = await browsercat.connect({ apiKey: 'YOUR_KEY' });
```

### Pros & Cons

**Pros:**
- ✅ No browser installation
- ✅ Handles anti-bot measures
- ✅ Scales automatically

**Cons:**
- ❌ Monthly costs ($29-99/mo)
- ❌ API limits
- ❌ Dependency on third party

---

## 📊 Comparison Table

| Feature | Python Script | Node.js Integration | Third-Party API |
|---------|--------------|---------------------|-----------------|
| **Setup Time** | 5 minutes | 30 minutes | 10 minutes |
| **Cost** | Free | Free | $29-99/mo |
| **Speed** | 3-10 sec | 3-10 sec | 1-5 sec |
| **Resource Usage** | Local only | Backend overhead | None |
| **Maintenance** | Low | Medium | Low |
| **Scalability** | Manual | Limited | High |
| **Best For** | One-off extractions | Integrated UX | Production apps |

---

## 🎯 Recommendation

For your use case (extracting from rolltide.com):

### **Use Python Script with Playwright**

**Rationale:**
1. ✅ **Quick solution** - Works immediately without changing web app
2. ✅ **Flexible** - Run on-demand when you need extractions
3. ✅ **Reliable** - Playwright is industry-standard
4. ✅ **No costs** - Completely free
5. ✅ **Better for JS sites** - Built specifically for this problem

### When to Choose Node.js Integration Instead:
- You need this feature **in the web UI** permanently
- Non-technical users need self-service access
- You're building a SaaS product

### When to Choose Third-Party API:
- Building a production application
- Need 100+ extractions per day
- Want to avoid browser management

---

## 🚀 Quick Start (Recommended Path)

```bash
# 1. Install Playwright
pip install playwright
playwright install chromium

# 2. Run the script
python directory_parser_playwright.py https://rolltide.com/staff-directory

# 3. Open contacts.csv
# Done! ✓
```

---

## 🐛 Troubleshooting

### "playwright: command not found"
```bash
python -m playwright install chromium
```

### Permission denied
```bash
chmod +x directory_parser_playwright.py
```

### Browser download fails
```bash
# Use offline installer
playwright install chromium --force
```

### Script times out
```bash
# Increase timeout in script (line 140):
page.goto(url, wait_until='domcontentloaded', timeout=120000)  # 2 minutes
```

---

## 💡 Alternative: Find the API

Some sites (including rolltide.com) may expose a JSON API that the JavaScript calls. You can:

1. **Open browser DevTools** (F12)
2. **Go to Network tab**
3. **Load the staff directory**
4. **Look for XHR/Fetch requests** returning JSON
5. **Call that API directly** (faster than rendering)

Example:
```bash
# If you find an API endpoint like:
curl "https://rolltide.com/api/staff?format=json"
```

This bypasses the need for browser rendering entirely!

---

## 📚 Resources

- [Playwright Python Docs](https://playwright.dev/python/)
- [Web Scraping Guide](https://www.zenrows.com/blog/web-scraping-python-tutorial)
- [Handling SPAs](https://scrapingant.com/blog/scrape-dynamic-website-with-python)
