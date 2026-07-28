#!/usr/bin/env python3
"""
Advanced Directory Parser with Playwright
Handles JavaScript-rendered pages like rolltide.com
"""

import re
import csv
import sys
from typing import List, Dict
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout


def extract_name_from_email(email: str) -> tuple[str, str]:
    """Extract first and last name from email address"""
    if not email or '@' not in email:
        return ("Unknown", "")
    
    local_part = email.split('@')[0]
    name_part = re.sub(r'\d+', '', local_part)
    name_parts = re.split(r'[._-]', name_part)
    name_parts = [part.capitalize() for part in name_parts if part]
    
    if len(name_parts) >= 2:
        return (name_parts[0], name_parts[-1])
    elif len(name_parts) == 1:
        return (name_parts[0], "")
    
    return ("Unknown", "")


def extract_contacts_from_page(page) -> List[Dict[str, str]]:
    """Extract contacts from rendered page"""
    contacts = []
    
    # Wait for page to be fully loaded
    try:
        page.wait_for_load_state('networkidle', timeout=30000)
    except PlaywrightTimeout:
        print("⚠️  Page still loading, attempting to extract anyway...")
    
    # Get all mailto links
    email_links = page.locator('a[href^="mailto:"]').all()
    print(f"Found {len(email_links)} email links")
    
    processed_emails = set()
    
    for link in email_links:
        try:
            # Extract email
            href = link.get_attribute('href')
            if not href:
                continue
            
            email = href.replace('mailto:', '').strip()
            if not email or email in processed_emails:
                continue
            processed_emails.add(email)
            
            # Find parent container
            # Try different container strategies
            container = None
            
            # Strategy 1: Find closest parent with specific classes/tags
            for selector in ['tr', 'li', '.staff-member', '.contact-card', '.card', 
                           '.person', '.employee', 'article', '.s-person-card',
                           '.staff-card', '.directory-item']:
                try:
                    container = link.locator(f'xpath=ancestor::{selector.replace(".", "")}[1]').first
                    if container.count() > 0:
                        break
                except:
                    continue
            
            # Strategy 2: Get reasonable parent div
            if not container or container.count() == 0:
                try:
                    # Walk up to find a div that's not too large
                    current = link
                    for _ in range(5):
                        parent = current.locator('xpath=..').first
                        if parent.count() == 0:
                            break
                        
                        # Check if this parent has multiple emails (too large)
                        sibling_emails = parent.locator('a[href^="mailto:"]').count()
                        if sibling_emails > 1:
                            container = current
                            break
                        
                        current = parent
                        if parent.evaluate('el => el.tagName') == 'DIV':
                            text_len = len(parent.inner_text())
                            if 10 < text_len < 1000:
                                container = parent
                                break
                except:
                    pass
            
            if not container or container.count() == 0:
                container = link.locator('xpath=..').first  # Fallback to parent
            
            # Extract data from container
            full_text = container.inner_text()
            
            # Extract phone
            phone_match = re.search(r'(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})', full_text)
            phone = phone_match.group(1) if phone_match else ""
            
            # Extract name
            first_name, last_name = "Unknown", ""
            
            # Try headings
            for tag in ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']:
                heading = container.locator(tag).first
                if heading.count() > 0:
                    name_text = heading.inner_text().strip()
                    if name_text and len(name_text) < 50 and '@' not in name_text:
                        parts = name_text.split()
                        if len(parts) >= 2:
                            first_name, last_name = parts[0], parts[-1]
                            break
                        elif len(parts) == 1:
                            first_name = parts[0]
                            break
            
            # Try strong/bold
            if first_name == "Unknown":
                strong = container.locator('strong, b').first
                if strong.count() > 0:
                    name_text = strong.inner_text().strip()
                    if name_text and len(name_text) < 50 and '@' not in name_text:
                        parts = name_text.split()
                        if len(parts) >= 2:
                            first_name, last_name = parts[0], parts[-1]
                        elif len(parts) == 1:
                            first_name = parts[0]
            
            # Try data attributes (common in SPAs)
            if first_name == "Unknown":
                try:
                    name_elem = container.locator('[data-name], [data-fullname], .name, .full-name').first
                    if name_elem.count() > 0:
                        name_text = name_elem.inner_text().strip()
                        if name_text:
                            parts = name_text.split()
                            if len(parts) >= 2:
                                first_name, last_name = parts[0], parts[-1]
                            elif len(parts) == 1:
                                first_name = parts[0]
                except:
                    pass
            
            # Fallback to email parsing
            if first_name == "Unknown":
                first_name, last_name = extract_name_from_email(email)
            
            # Extract title
            title = ""
            
            # Try title/position/role classes
            for class_name in ['title', 'position', 'role', 'job-title', 
                              'job_title', 'staff-title', 's-person-details']:
                try:
                    title_elem = container.locator(f'.{class_name}').first
                    if title_elem.count() > 0:
                        title_text = title_elem.inner_text().strip()
                        if title_text and len(title_text) < 100:
                            title = title_text
                            break
                except:
                    continue
            
            # Try data attributes
            if not title:
                try:
                    title_elem = container.locator('[data-title], [data-position]').first
                    if title_elem.count() > 0:
                        title = title_elem.inner_text().strip()
                except:
                    pass
            
            # Try paragraphs
            if not title:
                paragraphs = container.locator('p').all()
                for p in paragraphs:
                    text = p.inner_text().strip()
                    # Skip if contains email, phone, or name
                    full_name = f"{first_name} {last_name}".strip()
                    if (email not in text and phone not in text and 
                        full_name not in text and 2 < len(text) < 80 and 
                        '@' not in text):
                        title = text
                        break
            
            contacts.append({
                'first_name': first_name,
                'last_name': last_name,
                'title': title,
                'email': email,
                'phone': phone
            })
            
        except Exception as e:
            print(f"Error processing email {email}: {e}")
            continue
    
    return contacts


def scrape_directory(url: str, headless: bool = True) -> List[Dict[str, str]]:
    """Scrape staff directory using Playwright"""
    with sync_playwright() as p:
        print(f"Launching browser...")
        browser = p.chromium.launch(headless=headless)
        page = browser.new_page()
        
        print(f"Navigating to {url}...")
        page.goto(url, wait_until='domcontentloaded', timeout=60000)
        
        print("Waiting for content to load...")
        page.wait_for_timeout(3000)  # Wait for JavaScript to render
        
        # Try to wait for specific selectors
        try:
            page.wait_for_selector('a[href^="mailto:"]', timeout=10000)
        except PlaywrightTimeout:
            print("⚠️  Timeout waiting for email links, proceeding anyway...")
        
        print("Extracting contacts...")
        contacts = extract_contacts_from_page(page)
        
        browser.close()
        return contacts


def main():
    """Main function"""
    if len(sys.argv) < 2:
        print("Usage: python directory_parser_playwright.py <URL>")
        print("\nExamples:")
        print("  python directory_parser_playwright.py https://rolltide.com/staff-directory")
        print("  python directory_parser_playwright.py https://example.com/staff --visible")
        sys.exit(1)
    
    url = sys.argv[1]
    headless = '--visible' not in sys.argv
    
    # Scrape contacts
    contacts = scrape_directory(url, headless=headless)
    
    # Display results
    print(f"\n{'='*110}")
    print(f"Found {len(contacts)} contacts:\n")
    print(f"{'First Name':<15} {'Last Name':<15} {'Title':<30} {'Email':<30} {'Phone':<15}")
    print("-" * 110)
    
    for contact in contacts:
        print(f"{contact['first_name']:<15} {contact['last_name']:<15} "
              f"{contact['title']:<30} {contact['email']:<30} {contact['phone']:<15}")
    
    # Export to CSV
    output_file = 'contacts.csv'
    with open(output_file, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=['first_name', 'last_name', 'title', 'email', 'phone'])
        writer.writeheader()
        writer.writerows(contacts)
    
    print(f"\n✓ Exported {len(contacts)} contacts to {output_file}")
    print("="*110)


if __name__ == '__main__':
    main()
