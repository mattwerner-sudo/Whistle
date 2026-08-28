#!/usr/bin/env python3
"""
Directory Contact Parser
Extracts first name, last name, title, email, and phone from staff directory pages
"""

import re
import requests
from bs4 import BeautifulSoup
from typing import List, Dict, Optional
import csv
import sys


def extract_name_from_email(email: str) -> tuple[str, str]:
    """Extract first and last name from email address"""
    if not email or '@' not in email:
        return ("Unknown", "")
    
    # Get local part (before @)
    local_part = email.split('@')[0]
    
    # Remove numbers and split on separators
    name_part = re.sub(r'\d+', '', local_part)
    name_parts = re.split(r'[._-]', name_part)
    
    # Filter empty parts and capitalize
    name_parts = [part.capitalize() for part in name_parts if part]
    
    if len(name_parts) >= 2:
        return (name_parts[0], name_parts[-1])
    elif len(name_parts) == 1:
        return (name_parts[0], "")
    
    return ("Unknown", "")


def find_contact_container(email_link, soup) -> Optional[BeautifulSoup]:
    """Find the most specific container for a contact"""
    # Try common structural containers first
    for selector in ['tr', 'li', '.contact-card', '.card', '.person', '.employee', 'article']:
        container = email_link.find_parent(selector.replace('.', ''), class_=selector[1:] if '.' in selector else None)
        if container:
            return container
    
    # Smart traversal - find smallest reasonable div
    current = email_link.parent
    max_levels = 5
    level = 0
    
    while current and level < max_levels:
        # Check if container has multiple email links (too large)
        email_links = current.find_all('a', href=re.compile(r'^mailto:'))
        if len(email_links) > 1 and level > 0:
            return email_link.parent
        
        # Check if this is a reasonable div container
        if current.name == 'div':
            text_length = len(current.get_text(strip=True))
            if 10 < text_length < 1000:
                return current
        
        current = current.parent
        level += 1
    
    # Fallback to immediate parent
    return email_link.parent


def extract_name_from_container(container, email: str) -> tuple[str, str]:
    """Extract first and last name from container HTML"""
    # Try to find name in headings
    for tag in ['h1', 'h2', 'h3', 'h4', 'h5', 'strong', 'b']:
        element = container.find(tag)
        if element:
            text = element.get_text(strip=True)
            # Check if this looks like a name (not too long, no email/phone patterns)
            if text and len(text) < 50 and '@' not in text and not re.search(r'\d{3}[-.\s]?\d{3}', text):
                parts = text.split()
                if len(parts) >= 2:
                    return (parts[0], parts[-1])
                elif len(parts) == 1:
                    return (parts[0], "")
    
    # Try bio links
    bio_link = container.find('a', attrs={'aria-label': re.compile(r'Bio', re.I)})
    if not bio_link:
        bio_link = container.find('a', attrs={'title': re.compile(r'Bio', re.I)})
    
    if bio_link:
        bio_text = bio_link.get('aria-label', '') or bio_link.get('title', '')
        match = re.search(r'Full Bio for (.+)', bio_text, re.I)
        if match:
            name = match.group(1)
            parts = name.split()
            if len(parts) >= 2:
                return (parts[0], parts[-1])
    
    # Try first table cell
    if container.name == 'tr':
        first_cell = container.find('td')
        if first_cell:
            text = first_cell.get_text(strip=True)
            if text and '@' not in text and len(text) < 50:
                parts = text.split()
                if len(parts) >= 2:
                    return (parts[0], parts[-1])
    
    # Fallback to email extraction
    return extract_name_from_email(email)


def extract_title_from_container(container, name: str, email: str, phone: str) -> str:
    """Extract job title from container"""
    # Try elements with title/position/role classes
    for class_name in ['title', 'position', 'role', 'job-title', 'job_title']:
        element = container.find(class_=class_name)
        if element:
            title = element.get_text(strip=True)
            if title and len(title) < 100:
                return title
    
    # Try second table cell
    if container.name == 'tr':
        cells = container.find_all('td')
        if len(cells) >= 2:
            title = cells[1].get_text(strip=True)
            if title and '@' not in title and not re.search(r'\d{3}[-.\s]?\d{3}', title):
                return title
    
    # Try paragraphs and divs
    full_name = f"{name}"
    for element in container.find_all(['p', 'div']):
        text = element.get_text(strip=True)
        # Skip if contains email, phone, or name
        if email in text or phone in text or full_name in text:
            continue
        # Check if looks like a title
        if 2 < len(text) < 80 and '@' not in text and not re.search(r'\d{3}[-.\s]?\d{3}', text):
            return text
    
    return ""


def extract_phone_from_text(text: str) -> str:
    """Extract phone number from text"""
    # US phone number patterns
    phone_pattern = r'(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})'
    match = re.search(phone_pattern, text)
    return match.group(1) if match else ""


def parse_directory_page(html_content: str) -> List[Dict[str, str]]:
    """Parse directory page HTML and extract contacts"""
    soup = BeautifulSoup(html_content, 'html.parser')
    contacts = []
    processed_emails = set()
    
    # Find all mailto links
    email_links = soup.find_all('a', href=re.compile(r'^mailto:'))
    
    for link in email_links:
        # Extract email
        email = link.get('href', '').replace('mailto:', '').strip()
        if not email or email in processed_emails:
            continue
        processed_emails.add(email)
        
        # Find container
        container = find_contact_container(link, soup)
        if not container:
            continue
        
        # Get full text for phone extraction
        full_text = container.get_text(separator=' ', strip=True)
        phone = extract_phone_from_text(full_text)
        
        # Extract name
        first_name, last_name = extract_name_from_container(container, email)
        
        # Extract title
        title = extract_title_from_container(container, f"{first_name} {last_name}", email, phone)
        
        contacts.append({
            'first_name': first_name,
            'last_name': last_name,
            'title': title,
            'email': email,
            'phone': phone
        })
    
    return contacts


def fetch_url(url: str) -> str:
    """Fetch HTML content from URL"""
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
    response = requests.get(url, headers=headers, timeout=30)
    response.raise_for_status()
    return response.text


def main():
    """Main function"""
    if len(sys.argv) < 2:
        print("Usage: python directory_parser.py <URL or path/to/file.html>")
        print("\nExamples:")
        print("  python directory_parser.py https://example.com/staff")
        print("  python directory_parser.py staff_directory.html")
        sys.exit(1)
    
    input_source = sys.argv[1]
    
    # Determine if input is URL or file
    if input_source.startswith('http://') or input_source.startswith('https://'):
        print(f"Fetching URL: {input_source}")
        html_content = fetch_url(input_source)
    else:
        print(f"Reading file: {input_source}")
        with open(input_source, 'r', encoding='utf-8') as f:
            html_content = f.read()
    
    # Parse contacts
    print("Parsing contacts...")
    contacts = parse_directory_page(html_content)
    
    # Display results
    print(f"\nFound {len(contacts)} contacts:\n")
    print(f"{'First Name':<15} {'Last Name':<15} {'Title':<30} {'Email':<30} {'Phone':<15}")
    print("-" * 110)
    
    for contact in contacts:
        print(f"{contact['first_name']:<15} {contact['last_name']:<15} {contact['title']:<30} {contact['email']:<30} {contact['phone']:<15}")
    
    # Export to CSV
    output_file = 'contacts.csv'
    with open(output_file, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=['first_name', 'last_name', 'title', 'email', 'phone'])
        writer.writeheader()
        writer.writerows(contacts)
    
    print(f"\n✓ Exported {len(contacts)} contacts to {output_file}")


if __name__ == '__main__':
    main()
