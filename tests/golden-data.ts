export interface GoldenTestCase {
  name: string;
  html: string;
  expected: {
    name: string;
    title?: string | null;
    email: string | null;
  };
}

export const GOLDEN_SET: GoldenTestCase[] = [
  {
    name: "Standard Sidearm Site (Alabama)",
    html: `<div class="sidearm-staff-member">
             <div class="name">Nick Saban</div>
             <div class="title">Head Football Coach</div>
             <a href="mailto:nsaban@ua.edu">Email</a>
           </div>`,
    expected: { name: "Nick Saban", title: "Head Football Coach", email: "nsaban@ua.edu" }
  },
  {
    name: "Tricky/Broken HTML (Oregon State Edge Case)",
    html: `<div>
             <h3>Jonathan Smith</h3>
             Head Coach - Football
             <br>
             jsmith@oregonstate.edu
           </div>`,
    expected: { name: "Jonathan Smith", title: "Head Coach - Football", email: "jsmith@oregonstate.edu" }
  },
  {
    name: "Cloudflare Encrypted Email",
    html: `<div class="staff">
             <h4>Mike White</h4>
             <a href="/cdn-cgi/l/email-protection" data-cfemail="123f567b...">[email protected]</a>
           </div>`,
    expected: { name: "Mike White", email: null }
  },
  {
    name: "Table-based Layout",
    html: `<table class="staff-table">
             <tr>
               <td class="name">Sarah Johnson</td>
               <td class="title">Associate Athletic Director</td>
               <td><a href="mailto:sjohnson@athletics.edu">sjohnson@athletics.edu</a></td>
             </tr>
           </table>`,
    expected: { name: "Sarah Johnson", title: "Associate Athletic Director", email: "sjohnson@athletics.edu" }
  },
  {
    name: "Card Layout with Image",
    html: `<div class="staff-card">
             <img src="/images/coach.jpg" alt="Coach Photo">
             <h3 class="staff-name">Robert Williams</h3>
             <p class="staff-title">Strength & Conditioning Coach</p>
             <a class="email-link" href="mailto:rwilliams@university.edu">Contact</a>
           </div>`,
    expected: { name: "Robert Williams", title: "Strength & Conditioning Coach", email: "rwilliams@university.edu" }
  },
  {
    name: "Nested Div Structure",
    html: `<div class="directory-item">
             <div class="info">
               <div class="personal">
                 <span class="fullname">Emily Chen</span>
               </div>
               <div class="position">Director of Marketing</div>
               <div class="contact">
                 <a href="mailto:echen@athletics.com">echen@athletics.com</a>
               </div>
             </div>
           </div>`,
    expected: { name: "Emily Chen", title: "Director of Marketing", email: "echen@athletics.com" }
  },
  {
    name: "Phone Number with Email",
    html: `<div class="person">
             <strong>Michael Brown</strong>
             <p>Athletic Trainer</p>
             <p>Phone: (555) 123-4567</p>
             <p>Email: mbrown@state.edu</p>
           </div>`,
    expected: { name: "Michael Brown", title: "Athletic Trainer", email: "mbrown@state.edu" }
  },
  {
    name: "Multi-line Bio Format",
    html: `<article class="bio">
             <header>
               <h2>Dr. Lisa Park</h2>
               <h3>Team Physician</h3>
             </header>
             <footer>
               <a href="mailto:lpark@medical.edu">Send Email</a>
             </footer>
           </article>`,
    expected: { name: "Dr. Lisa Park", title: "Team Physician", email: "lpark@medical.edu" }
  },
  {
    name: "Sidearm Stamp Layout",
    html: `<div class="s-stamp__item">
             <div class="s-stamp__header"><a href="/staff/john-doe">John Doe</a></div>
             <div class="s-stamp__position">Associate AD for Compliance</div>
             <a href="mailto:jdoe@tigers.edu">jdoe@tigers.edu</a>
           </div>`,
    expected: { name: "John Doe", title: "Associate AD for Compliance", email: "jdoe@tigers.edu" }
  },
  {
    name: "Sidearm Person Card Modern",
    html: `<div class="s-person-card">
             <div class="s-person-card__name">Amanda Rodriguez</div>
             <div class="s-person-card__position">Director of Athletics Communications</div>
             <a href="mailto:arodriguez@wildcats.edu">Email</a>
           </div>`,
    expected: { name: "Amanda Rodriguez", title: "Director of Athletics Communications", email: "arodriguez@wildcats.edu" }
  },
  {
    name: "Schema.org Person Markup",
    html: `<div itemscope itemtype="https://schema.org/Person">
             <span itemprop="name">Carlos Vega</span>
             <span itemprop="jobTitle">Head Baseball Coach</span>
             <a itemprop="email" href="mailto:cvega@hawks.edu">cvega@hawks.edu</a>
           </div>`,
    expected: { name: "Carlos Vega", title: "Head Baseball Coach", email: "cvega@hawks.edu" }
  },
  {
    name: "ARIA Role Listitem",
    html: `<div role="listitem">
             <h3>Michelle Torres</h3>
             <p class="position">Senior Associate AD</p>
             <a href="mailto:mtorres@bears.edu">mtorres@bears.edu</a>
           </div>`,
    expected: { name: "Michelle Torres", title: "Senior Associate AD", email: "mtorres@bears.edu" }
  },
  {
    name: "WordPress Elementor Layout",
    html: `<div class="elementor-widget-container">
             <h3>James Patterson</h3>
             <p class="job-title">Equipment Manager</p>
             <a href="mailto:jpatterson@eagles.edu">Contact</a>
           </div>`,
    expected: { name: "James Patterson", title: "Equipment Manager", email: "jpatterson@eagles.edu" }
  },
  {
    name: "Presto Bio Card",
    html: `<div class="bio-card">
             <div class="bio-name">Rebecca Liu</div>
             <div class="bio-title">Academic Advisor</div>
             <a href="mailto:rliu@rams.edu">rliu@rams.edu</a>
           </div>`,
    expected: { name: "Rebecca Liu", title: "Academic Advisor", email: "rliu@rams.edu" }
  },
  {
    name: "Data Attribute Person",
    html: `<div data-type="person">
             <span data-field="name">David Kim</span>
             <span data-field="title">Head Athletic Trainer</span>
             <a href="mailto:dkim@panthers.edu">dkim@panthers.edu</a>
           </div>`,
    expected: { name: "David Kim", title: "Head Athletic Trainer", email: "dkim@panthers.edu" }
  },
  {
    name: "Table with Data Labels",
    html: `<table class="staff-table">
             <tr>
               <td data-label="Name">Patricia Wells</td>
               <td data-label="Title">Ticket Manager</td>
               <td data-label="Phone">(555) 987-6543</td>
               <td><a href="mailto:pwells@cougars.edu">pwells@cougars.edu</a></td>
             </tr>
           </table>`,
    expected: { name: "Patricia Wells", title: "Ticket Manager", email: "pwells@cougars.edu" }
  },
  {
    name: "Profile Card Layout",
    html: `<div class="profile-card">
             <img src="/headshots/smith.jpg" alt="Photo">
             <h4>Thomas Smith</h4>
             <span class="designation">Strength & Conditioning Coordinator</span>
             <a href="mailto:tsmith@bulldogs.edu">Email</a>
           </div>`,
    expected: { name: "Thomas Smith", title: "Strength & Conditioning Coordinator", email: "tsmith@bulldogs.edu" }
  },
  {
    name: "Sidearm Tabular Split-Email Script",
    html: `<table class="sidearm-table">
             <tbody>
               <tr class="sidearm-staff-member" data-member-id="1">
                 <td headers="col-fullname category-0">
                   <a aria-label="Doug Gillin, Administration, Director of Athletics" href="/staff-directory/doug-gillin/1">Doug Gillin</a>
                 </td>
                 <td headers="col-staff_title category-0">Director of Athletics</td>
                 <td headers="col-staff_phone category-0">
                   <a href="tel:828-262-7825">828-262-7825</a>
                 </td>
                 <td headers="col-staff_email category-0">
                   <a id="staff_email_0" href="#"></a>
                   <script type="text/javascript">
                     var placeholder = document.getElementById("staff_email_0");
                     var firstHalf = "dgillin";
                     var secondHalf = "appstate.edu";
                     var full_email = firstHalf + '@' + secondHalf;
                     placeholder.href = 'mailto:' + full_email;
                     placeholder.innerText = full_email;
                   </script>
                 </td>
               </tr>
             </tbody>
           </table>`,
    expected: { name: "Doug Gillin", title: "Director of Athletics", email: "dgillin@appstate.edu" }
  },
  {
    name: "Sidearm Tabular - aria-label Name without Bio Phrase",
    html: `<table class="sidearm-table">
             <tbody>
               <tr class="sidearm-staff-member" data-member-id="2">
                 <td headers="col-fullname category-0">
                   <a aria-label="Michael Kelly, ADMINISTRATION, Director of Athletics" href="/staff-directory/michael-kelly/2">Michael Kelly</a>
                 </td>
                 <td headers="col-staff_title category-0">Director of Athletics</td>
                 <td headers="col-staff_phone category-0">
                   <a href="tel:410-293-8910">410-293-8910</a>
                 </td>
                 <td headers="col-staff_email category-0">
                   <a id="staff_email_0" href="#"></a>
                   <script>
                     var firstHalf = "mskelly";
                     var secondHalf = "usna.edu";
                   </script>
                 </td>
               </tr>
             </tbody>
           </table>`,
    expected: { name: "Michael Kelly", title: "Director of Athletics", email: "mskelly@usna.edu" }
  },
  {
    name: "Sidearm S-Person-Card with Bio Aria-Label",
    html: `<div class="s-person-card s-person-card--list">
             <div class="s-person-details">
               <a href="/staff-directory/josh-brooks/3" aria-label="Josh Brooks full bio">
                 <span class="s-text-regular-bold">Josh Brooks</span>
               </a>
               <div class="s-person-details__position">Director of Athletics</div>
               <a href="mailto:jbrooks@georgiadogs.com">Email</a>
             </div>
           </div>`,
    expected: { name: "Josh Brooks", title: "Director of Athletics", email: "jbrooks@georgiadogs.com" }
  },
  {
    name: "Sidearm Concat Email Script (document.write style)",
    html: `<table class="sidearm-table"><tbody>
             <tr class="sidearm-staff-member">
               <td headers="col-fullname"><a aria-label="Sara Lee, Compliance, Compliance Director" href="/staff/2">Sara Lee</a></td>
               <td headers="col-staff_title">Compliance Director</td>
               <td headers="col-staff_email">
                 <script>document.write("slee" + "@" + "school.edu");</script>
               </td>
             </tr>
           </tbody></table>`,
    expected: { name: "Sara Lee", title: "Compliance Director", email: "slee@school.edu" }
  }
];

export const PERSONA_TEST_CASES = [
  { title: "Athletic Director", expectedPersona: "signer", expectedArea: "executive" },
  { title: "Head Football Coach", expectedPersona: "champion", expectedArea: "performance" },
  { title: "Associate Athletic Director", expectedPersona: "champion", expectedArea: "executive" },
  { title: "Director of Marketing", expectedPersona: "champion", expectedArea: "external" },
  { title: "Athletic Communications Coordinator", expectedPersona: "influencer", expectedArea: "external" },
  { title: "Administrative Assistant", expectedPersona: "gatekeeper", expectedArea: "general" },
  { title: "Strength & Conditioning Coach", expectedPersona: "user", expectedArea: "performance" },
  { title: "CFO", expectedPersona: "blocker", expectedArea: "finance" },
  { title: "Compliance Director", expectedPersona: "blocker", expectedArea: "operations" },
  { title: "Director of Operations", expectedPersona: "champion", expectedArea: "operations" },
];

export const TECH_STACK_TEST_CASES = [
  {
    name: "Sidearm Sports Detection",
    html: `<html><head><script src="https://sidearm.com/widget.js"></script></head><body>Test</body></html>`,
    expectedTech: ["Sidearm Sports"]
  },
  {
    name: "Multiple Tech Detection",
    html: `<html>
      <head>
        <script src="https://teamworks.com/api.js"></script>
        <link rel="stylesheet" href="https://paciolan.com/styles.css">
      </head>
      <body>Test</body>
    </html>`,
    expectedTech: ["Teamworks", "Paciolan"]
  },
  {
    name: "No Tech Detection",
    html: `<html><head><title>Simple Page</title></head><body>Content</body></html>`,
    expectedTech: []
  }
];
