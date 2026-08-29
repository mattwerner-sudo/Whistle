// Reference: javascript_gemini blueprint integration
import { GoogleGenAI } from "@google/genai";
import type { ContactPerson } from "@shared/schema";

// Check if API key is configured
const apiKey = process.env.GEMINI_API_KEY;
const useMockResponses = !apiKey;

if (useMockResponses) {
  console.log("ℹ️  Running in mock mode - AI responses will be simulated (no API key required)");
} else {
  console.log("✅ Gemini AI configured with API key");
}

const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

export async function analyzeTeamStructure(contacts: ContactPerson[]): Promise<string> {
  if (useMockResponses) {
    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    const titleCounts = contacts.reduce((acc, c) => {
      const title = c.title || "Unknown";
      acc[title] = (acc[title] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    const topTitles = Object.entries(titleCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5);
    
    return `# Team Structure Analysis

## Hierarchy Overview
This organization consists of **${contacts.length} team members** across various departments and roles. The structure appears to be a typical organizational hierarchy with leadership, management, and specialized roles.

## Key Roles
Based on the data extracted, key positions include:
${topTitles.map(([title, count]) => `- **${title}**: ${count} ${count === 1 ? 'person' : 'people'}`).join('\n')}

## Department Breakdown
The team is distributed across multiple functional areas:
- Leadership & Administration
- Operations & Program Management
- Support & Coordination Roles
- Specialized Functions

## Strategic Insights
- **Team Size**: ${contacts.length} total contacts identified
- **Communication**: ${contacts.filter(c => c.email).length} email addresses available for direct outreach
- **Contact Data**: ${contacts.filter(c => c.phone).length} phone numbers available
- **Opportunity**: This organizational structure suggests multiple entry points for engagement and collaboration

*Note: This is a simulated AI analysis. For enhanced insights, configure a Gemini API key.*`;
  }
  
  const dataSummary = contacts.slice(0, 100).map(p => `${p.name} (${p.title})`).join("\n");
  
  const prompt = `Analyze this staff list and provide a comprehensive summary with the following sections:

1. **Hierarchy Overview**: Identify the organizational structure
2. **Key Roles**: Highlight leadership and important positions
3. **Department Breakdown**: Categorize staff by department or function
4. **Insights**: Provide strategic observations about the team composition

Staff List:
${dataSummary}

Provide the analysis in markdown format with clear headers and bullet points.`;

  const response = await ai!.models.generateContent({
    model: "gemini-flash-latest",
    contents: prompt,
  });

  return response.text || "Analysis could not be generated.";
}

export async function cleanContactData(contacts: ContactPerson[]): Promise<ContactPerson[]> {
  if (useMockResponses) {
    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Perform basic data cleaning
    return contacts.map(contact => ({
      ...contact,
      name: contact.name
        .replace(/Full Bio for/gi, '')
        .trim()
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' '),
      title: contact.title
        .replace(/Full Bio for/gi, '')
        .trim()
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' '),
      phone: contact.phone ? formatPhoneNumber(contact.phone) : contact.phone,
    }));
  }
  
  const prompt = `Clean and fix this contact data JSON array:
- Remove "Full Bio for" prefixes from names
- Properly capitalize names and titles
- Format phone numbers consistently
- Fix any obvious data quality issues

Return ONLY a valid JSON array with the cleaned data. Do not include markdown code blocks or any other text.

Input:
${JSON.stringify(contacts, null, 2)}`;

  const response = await ai!.models.generateContent({
    model: "gemini-flash-latest",
    contents: prompt,
  });

  let result = response.text || "";
  
  // Remove markdown code blocks if present
  result = result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  
  try {
    const cleaned = JSON.parse(result);
    return Array.isArray(cleaned) ? cleaned : contacts;
  } catch (error) {
    console.error("Failed to parse cleaned data:", error);
    throw new Error("Failed to clean contact data");
  }
}

function formatPhoneNumber(phone: string): string {
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '');
  
  // Format as (XXX) XXX-XXXX if we have 10 digits
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  
  return phone; // Return original if can't format
}

export async function generateEmailDraft(recipient: ContactPerson, context: string): Promise<{ subject: string; body: string }> {
  if (useMockResponses) {
    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 1200));
    
    const contextText = context || "exploring potential collaboration opportunities";
    
    return {
      subject: `Exploring Collaboration - ${recipient.name}`,
      body: `Dear ${recipient.name},

I hope this email finds you well. I came across your profile and was impressed by your work as ${recipient.title}.

${contextText.charAt(0).toUpperCase() + contextText.slice(1)}.

I believe there could be valuable synergies between our organizations, and I'd love to explore how we might work together. Would you be open to a brief conversation in the coming weeks?

I'm flexible with timing and happy to work around your schedule. Please let me know if you'd be interested, and we can find a time that works best for you.

Looking forward to potentially connecting.

Best regards

---
Note: This is a simulated email draft. For AI-powered personalization, configure a Gemini API key.`
    };
  }
  
  const prompt = `Write a professional cold email for the following:

Recipient: ${recipient.name}
Title: ${recipient.title}
Email: ${recipient.email}
Goal/Context: ${context || "Introduction and networking"}

Generate a compelling email with:
1. An engaging subject line
2. A personalized, professional body that addresses their role and the stated goal

Return the response as JSON in this exact format (no markdown):
{
  "subject": "...",
  "body": "..."
}`;

  const response = await ai!.models.generateContent({
    model: "gemini-flash-latest",
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "object",
        properties: {
          subject: { type: "string" },
          body: { type: "string" },
        },
        required: ["subject", "body"],
      },
    },
    contents: prompt,
  });

  const result = response.text;
  
  if (!result) {
    throw new Error("Email generation failed");
  }

  try {
    const parsed = JSON.parse(result);
    return {
      subject: parsed.subject || "Meeting Request",
      body: parsed.body || "Email generation failed",
    };
  } catch (error) {
    throw new Error("Failed to parse email draft");
  }
}

export async function generateMeetingPrep(recipient: ContactPerson, topic: string): Promise<string> {
  if (useMockResponses) {
    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 1300));
    
    return `# Meeting Preparation: ${recipient.name}

## Role Context
**${recipient.name}** serves as **${recipient.title}**. In this capacity, they likely oversee key strategic initiatives, manage team operations, and serve as a decision-maker for their area of responsibility.

## Agenda
**Meeting Topic**: ${topic}

Key discussion points:
- **Objective Alignment**: Clarify mutual goals and expected outcomes
- **Value Proposition**: Present how this collaboration benefits their objectives
- **Next Steps**: Define clear action items and timeline

## Strategic Questions
1. *"What are your top priorities for this quarter, and how might this ${topic} align with those goals?"*
2. *"What challenges have you faced in similar initiatives, and what would make this more successful?"*

## Icebreaker
"I noticed your role as ${recipient.title} - that sounds like an exciting position! What's the most rewarding aspect of your work?"

---
*Note: This is a simulated meeting prep guide. For AI-powered insights, configure a Gemini API key.*`;
  }
  
  const prompt = `Generate meeting preparation intelligence for:

Meeting with: ${recipient.name}
Their Title: ${recipient.title}
Meeting Topic: ${topic}

Provide a comprehensive meeting prep document in markdown format with:

## Role Context
Brief overview of their position and likely responsibilities

## Agenda
3 key talking points or items to cover

## Strategic Questions
2 insightful questions to ask during the meeting

## Icebreaker
A natural conversation starter based on their role`;

  const response = await ai!.models.generateContent({
    model: "gemini-flash-latest",
    contents: prompt,
  });

  return response.text || "Meeting prep could not be generated.";
}
