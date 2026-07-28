import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Athletics Directory API',
      version: '1.0.0',
      description: `
Headless API for enriching collegiate athletics contact data.

## Authentication
All endpoints require Bearer token authentication. Create an API key first, then include it in your requests:

\`\`\`
Authorization: Bearer sk_live_your_key_here
\`\`\`

## Rate Limits
- 100 requests per 15 minutes per IP
- Admin endpoints: 10 requests per minute

## Integration Examples
This API is designed for use with:
- **Clay** - Use the /enrich endpoint as a Clay enrichment action
- **Zapier** - Subscribe to webhooks for automated workflows
- **HubSpot** - Bulk enrich contacts via /match endpoint
      `,
      contact: {
        name: 'API Support',
      },
    },
    servers: [
      { 
        url: '/api/v1',
        description: 'API v1 endpoints'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: { 
          type: 'http', 
          scheme: 'bearer', 
          bearerFormat: 'API Key',
          description: 'API key in format: sk_live_...'
        }
      },
      schemas: {
        School: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'alabama' },
            name: { type: 'string', example: 'University of Alabama' },
            division: { type: 'string', example: 'Division I' },
            conference: { type: 'string', example: 'Southeastern Conference' },
            athleticsUrl: { type: 'string', example: 'https://rolltide.com' },
            logoUrl: { type: 'string' },
            extractionStatus: { type: 'string', enum: ['pending', 'completed', 'failed'] }
          }
        },
        StaffMember: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            name: { type: 'string', example: 'John Smith' },
            title: { type: 'string', example: 'Athletic Director' },
            email: { type: 'string', example: 'jsmith@alabama.edu' },
            phone: { type: 'string', example: '(205) 555-1234' },
            department: { type: 'string' },
            office: { type: 'string' }
          }
        },
        EnrichRequest: {
          type: 'object',
          properties: {
            domain: { type: 'string', example: 'rolltide.com', description: 'Athletics website domain' },
            schoolName: { type: 'string', example: 'Alabama', description: 'School name for fuzzy matching' },
            schoolId: { type: 'string', example: 'alabama', description: 'Direct school ID lookup' }
          }
        },
        EnrichResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            school: { $ref: '#/components/schemas/School' },
            staff: { 
              type: 'array', 
              items: { $ref: '#/components/schemas/StaffMember' } 
            },
            staffCount: { type: 'integer' },
            confidence: { 
              type: 'string', 
              enum: ['high', 'medium', 'low'],
              description: 'Match confidence based on fuzzy score'
            },
            matchScore: { type: 'number', description: 'Raw fuzzy match score (0-1)' }
          }
        },
        MatchRequest: {
          type: 'object',
          required: ['accounts'],
          properties: {
            accounts: { 
              type: 'array', 
              items: { type: 'string' },
              maxItems: 500,
              example: ['Alabama', 'Ohio State', 'Michigan']
            }
          }
        },
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            message: { type: 'string' }
          }
        }
      }
    },
    security: [{ bearerAuth: [] }]
  },
  apis: ['./server/routes.ts'],
};

export const swaggerSpec = swaggerJsdoc(options);
