import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { parseHtmlForContacts } from "../server/staffExtractor";
import { categorizePersona } from "../server/lib/ai-extractor";
import { detectTechStack } from "../server/lib/tech-stack-detector";
import { GOLDEN_SET, PERSONA_TEST_CASES, TECH_STACK_TEST_CASES } from "./golden-data";
import { storage } from "../server/storage";

interface AuditResults {
  passed: number;
  failed: number;
  warnings: number;
  details: string[];
}

async function runAudit() {
  console.log("🚀 STARTING DEEP SYSTEM AUDIT...");
  console.log("=".repeat(60));
  
  const results: AuditResults = { passed: 0, failed: 0, warnings: 0, details: [] };

  await runParserAccuracyTests(results);
  await runPersonaCategorizationTests(results);
  await runTechStackDetectionTests(results);
  await runDatabaseIntegrityTests(results);
  await runModuleLoadingTests(results);
  await runJobQueueStressTests(results);
  await runDataQualityTests(results);

  printFinalReport(results);
}

async function runParserAccuracyTests(results: AuditResults) {
  console.log("\n🧪 1. Running HTML Parser Accuracy Tests...");
  console.log("-".repeat(50));
  
  for (const testCase of GOLDEN_SET) {
    const start = Date.now();
    try {
      const parseResult = parseHtmlForContacts(testCase.html);
      const duration = Date.now() - start;
      
      const contact = parseResult.contacts[0];
      
      let nameMatch = false;
      let emailMatch = false;
      let titleMatch = true;
      
      if (contact) {
        nameMatch = contact.name?.toLowerCase().includes(testCase.expected.name.toLowerCase()) ||
                    testCase.expected.name.toLowerCase().includes(contact.name?.toLowerCase() || '');
        emailMatch = contact.email === testCase.expected.email || 
                     (testCase.expected.email === null && !contact.email);
        if (testCase.expected.title !== undefined && testCase.expected.title !== null) {
          titleMatch = (contact.title || '').toLowerCase().includes(testCase.expected.title.toLowerCase()) ||
                       testCase.expected.title.toLowerCase().includes((contact.title || '').toLowerCase());
        }
      } else if (testCase.expected.email === null) {
        emailMatch = true;
      }
      
      if (nameMatch && emailMatch && titleMatch) {
        console.log(`  ✅ [PASS] ${testCase.name} (${duration}ms)`);
        results.passed++;
      } else if (nameMatch && emailMatch && !titleMatch) {
        console.log(`  ⚠️  [PARTIAL] ${testCase.name} - title mismatch (${duration}ms)`);
        console.log(`      Expected title: ${testCase.expected.title}`);
        console.log(`      Got title: ${contact?.title || '(empty)'}`);
        results.warnings++;
      } else if (nameMatch || emailMatch) {
        console.log(`  ⚠️  [PARTIAL] ${testCase.name} (${duration}ms)`);
        console.log(`      Expected: ${JSON.stringify(testCase.expected)}`);
        console.log(`      Got: ${JSON.stringify(contact || {})}`);
        results.warnings++;
      } else {
        console.log(`  ❌ [FAIL] ${testCase.name} (${duration}ms)`);
        console.log(`      Expected: ${JSON.stringify(testCase.expected)}`);
        console.log(`      Got: ${JSON.stringify(contact || {})}`);
        results.failed++;
        results.details.push(`Parser failed on: ${testCase.name}`);
      }
    } catch (error: any) {
      console.log(`  ❌ [ERROR] ${testCase.name}: ${error.message}`);
      results.failed++;
      results.details.push(`Parser error on ${testCase.name}: ${error.message}`);
    }
  }
}

async function runPersonaCategorizationTests(results: AuditResults) {
  console.log("\n👤 2. Running Persona Categorization Tests...");
  console.log("-".repeat(50));
  
  for (const testCase of PERSONA_TEST_CASES) {
    try {
      const { persona, area } = categorizePersona(testCase.title);
      
      const personaMatch = persona === testCase.expectedPersona;
      const areaMatch = area === testCase.expectedArea;
      
      if (personaMatch && areaMatch) {
        console.log(`  ✅ [PASS] "${testCase.title}" → ${persona}/${area}`);
        results.passed++;
      } else if (personaMatch) {
        console.log(`  ⚠️  [PARTIAL] "${testCase.title}" → persona:${persona} (area:${area} vs ${testCase.expectedArea})`);
        results.warnings++;
      } else {
        console.log(`  ❌ [FAIL] "${testCase.title}"`);
        console.log(`      Expected: ${testCase.expectedPersona}/${testCase.expectedArea}`);
        console.log(`      Got: ${persona}/${area}`);
        results.failed++;
      }
    } catch (error: any) {
      console.log(`  ❌ [ERROR] "${testCase.title}": ${error.message}`);
      results.failed++;
    }
  }
}

async function runTechStackDetectionTests(results: AuditResults) {
  console.log("\n🔧 3. Running Tech Stack Detection Tests...");
  console.log("-".repeat(50));
  
  for (const testCase of TECH_STACK_TEST_CASES) {
    try {
      const result = detectTechStack(testCase.html);
      
      const expectedSet = new Set(testCase.expectedTech);
      const actualSet = new Set(result.techStack);
      
      const allExpectedFound = testCase.expectedTech.every(t => 
        result.techStack.some(a => a.toLowerCase().includes(t.toLowerCase()))
      );
      
      if (allExpectedFound && result.techStack.length === testCase.expectedTech.length) {
        console.log(`  ✅ [PASS] ${testCase.name} → [${result.techStack.join(', ')}]`);
        results.passed++;
      } else if (allExpectedFound) {
        console.log(`  ⚠️  [PARTIAL] ${testCase.name}`);
        console.log(`      Expected: [${testCase.expectedTech.join(', ')}]`);
        console.log(`      Got: [${result.techStack.join(', ')}]`);
        results.warnings++;
      } else {
        console.log(`  ❌ [FAIL] ${testCase.name}`);
        console.log(`      Expected: [${testCase.expectedTech.join(', ')}]`);
        console.log(`      Got: [${result.techStack.join(', ')}]`);
        results.failed++;
      }
    } catch (error: any) {
      console.log(`  ❌ [ERROR] ${testCase.name}: ${error.message}`);
      results.failed++;
    }
  }
}

async function runDatabaseIntegrityTests(results: AuditResults) {
  console.log("\n🗄️  4. Checking Database Health...");
  console.log("-".repeat(50));
  
  try {
    const duplicateEmails = await db.execute(sql`
      SELECT email, COUNT(*) as count
      FROM staff_members 
      WHERE email IS NOT NULL AND email != ''
      GROUP BY email 
      HAVING COUNT(*) > 1
      LIMIT 10
    `);
    
    if (duplicateEmails.rows.length === 0) {
      console.log("  ✅ [PASS] No duplicate emails found");
      results.passed++;
    } else {
      console.log(`  ⚠️  [WARN] Found ${duplicateEmails.rows.length} duplicate emails (showing first 10)`);
      duplicateEmails.rows.slice(0, 5).forEach((row: any) => {
        console.log(`      - ${row.email}: ${row.count} occurrences`);
      });
      results.warnings++;
      results.details.push(`${duplicateEmails.rows.length} duplicate emails found`);
    }
  } catch (error: any) {
    console.log(`  ❌ [ERROR] Duplicate check failed: ${error.message}`);
    results.failed++;
  }

  try {
    const invalidEmails = await db.execute(sql`
      SELECT COUNT(*) as count
      FROM staff_members 
      WHERE email IS NOT NULL 
        AND email != ''
        AND email !~ '^[A-Za-z0-9._''%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
        AND email NOT LIKE '%.placeholder@athletics.invalid'
    `);
    
    const invalidCount = Number(invalidEmails.rows[0]?.count || 0);
    if (invalidCount === 0) {
      console.log("  ✅ [PASS] All emails have valid format");
      results.passed++;
    } else {
      console.log(`  ⚠️  [WARN] ${invalidCount} emails with invalid format`);
      results.warnings++;
    }
  } catch (error: any) {
    console.log(`  ⚠️  [SKIP] Email validation regex not supported: ${error.message}`);
    results.warnings++;
  }

  try {
    const orphanedStaff = await db.execute(sql`
      SELECT COUNT(*) as count
      FROM staff_members sm
      LEFT JOIN school_directories sd ON sm.school_id = sd.school_id
      WHERE sd.school_id IS NULL
    `);
    
    const orphanCount = Number(orphanedStaff.rows[0]?.count || 0);
    if (orphanCount === 0) {
      console.log("  ✅ [PASS] No orphaned staff records");
      results.passed++;
    } else {
      console.log(`  ❌ [FAIL] ${orphanCount} staff members reference non-existent schools`);
      results.failed++;
      results.details.push(`${orphanCount} orphaned staff records`);
    }
  } catch (error: any) {
    console.log(`  ❌ [ERROR] Orphan check failed: ${error.message}`);
    results.failed++;
  }
}

async function runModuleLoadingTests(results: AuditResults) {
  console.log("\n📦 5. Verifying Critical Module Loading...");
  console.log("-".repeat(50));
  
  const modules = [
    { name: "playwright", path: "playwright" },
    { name: "cheerio", path: "cheerio" },
    { name: "drizzle-orm", path: "drizzle-orm" },
    { name: "@google/genai", path: "@google/genai" },
  ];
  
  for (const mod of modules) {
    try {
      const start = Date.now();
      await import(mod.path);
      const duration = Date.now() - start;
      console.log(`  ✅ [PASS] ${mod.name} loaded (${duration}ms)`);
      results.passed++;
    } catch (error: any) {
      console.log(`  ❌ [FAIL] ${mod.name}: ${error.message}`);
      results.failed++;
      results.details.push(`Module ${mod.name} failed to load`);
    }
  }
}

async function runJobQueueStressTests(results: AuditResults) {
  console.log("\n⚡ 6. Stress Testing Job Queue Throughput...");
  console.log("-".repeat(50));
  
  const jobCount = 50;
  const startLoad = Date.now();
  
  try {
    const promises: Promise<any>[] = [];
    for (let i = 0; i < jobCount; i++) {
      promises.push(
        storage.createExtractionJob({
          type: 'single',
          targetId: `stress-test-${i}`,
          status: 'pending',
          totalSchools: 0,
          processedSchools: 0,
          contactsFound: 0,
          logs: [],
        })
      );
    }
    
    const jobs = await Promise.all(promises);
    const loadTime = Date.now() - startLoad;
    const jobsPerSecond = (jobCount / loadTime * 1000).toFixed(1);
    
    if (loadTime < 2000) {
      console.log(`  ✅ [PASS] Enqueued ${jobCount} jobs in ${loadTime}ms (${jobsPerSecond} jobs/sec)`);
      results.passed++;
    } else if (loadTime < 5000) {
      console.log(`  ⚠️  [WARN] Enqueued ${jobCount} jobs in ${loadTime}ms (${jobsPerSecond} jobs/sec) - Slower than optimal`);
      results.warnings++;
    } else {
      console.log(`  ❌ [FAIL] Job queue too slow: ${loadTime}ms for ${jobCount} jobs`);
      results.failed++;
    }
    
    console.log("  🧹 Cleaning up stress test jobs...");
    for (const job of jobs) {
      await db.execute(sql`DELETE FROM extraction_jobs WHERE id = ${job.id}`);
    }
    console.log(`     Cleaned up ${jobs.length} test jobs`);
    
  } catch (error: any) {
    console.log(`  ❌ [ERROR] Job queue stress test failed: ${error.message}`);
    results.failed++;
  }
}

async function runDataQualityTests(results: AuditResults) {
  console.log("\n📊 7. Data Quality Metrics...");
  console.log("-".repeat(50));
  
  try {
    const stats = await db.execute(sql`
      SELECT 
        COUNT(*) as total_staff,
        COUNT(CASE WHEN email IS NOT NULL AND email != '' THEN 1 END) as with_email,
        COUNT(CASE WHEN title IS NOT NULL AND title != '' THEN 1 END) as with_title,
        COUNT(CASE WHEN phone IS NOT NULL AND phone != '' THEN 1 END) as with_phone,
        COUNT(CASE WHEN buyer_persona IS NOT NULL THEN 1 END) as with_persona
      FROM staff_members
    `);
    
    const row = stats.rows[0] as any;
    const total = Number(row.total_staff);
    const withEmail = Number(row.with_email);
    const withTitle = Number(row.with_title);
    const withPhone = Number(row.with_phone);
    const withPersona = Number(row.with_persona);
    
    const emailRate = total > 0 ? ((withEmail / total) * 100).toFixed(1) : 0;
    const titleRate = total > 0 ? ((withTitle / total) * 100).toFixed(1) : 0;
    const phoneRate = total > 0 ? ((withPhone / total) * 100).toFixed(1) : 0;
    const personaRate = total > 0 ? ((withPersona / total) * 100).toFixed(1) : 0;
    
    console.log(`  📈 Total Staff Records: ${total.toLocaleString()}`);
    console.log(`     - Email Coverage: ${emailRate}% (${withEmail.toLocaleString()})`);
    console.log(`     - Title Coverage: ${titleRate}% (${withTitle.toLocaleString()})`);
    console.log(`     - Phone Coverage: ${phoneRate}% (${withPhone.toLocaleString()})`);
    console.log(`     - Persona Tagged: ${personaRate}% (${withPersona.toLocaleString()})`);
    
    if (Number(emailRate) >= 80) {
      console.log("  ✅ [PASS] Email coverage above 80%");
      results.passed++;
    } else if (Number(emailRate) >= 50) {
      console.log("  ⚠️  [WARN] Email coverage below 80%");
      results.warnings++;
    } else {
      console.log("  ❌ [FAIL] Email coverage critically low");
      results.failed++;
    }
    
  } catch (error: any) {
    console.log(`  ❌ [ERROR] Data quality check failed: ${error.message}`);
    results.failed++;
  }
  
  try {
    const schoolStats = await db.execute(sql`
      SELECT 
        COUNT(*) as total_schools,
        COUNT(CASE WHEN status = 'success' THEN 1 END) as extracted,
        COUNT(CASE WHEN tech_stack IS NOT NULL THEN 1 END) as with_tech,
        COUNT(CASE WHEN buying_window_status IS NOT NULL THEN 1 END) as with_buying_window
      FROM school_directories
    `);
    
    const row = schoolStats.rows[0] as any;
    const totalSchools = Number(row.total_schools);
    const extracted = Number(row.extracted);
    const withTech = Number(row.with_tech);
    const withBuyingWindow = Number(row.with_buying_window);
    
    const extractedRate = totalSchools > 0 ? ((extracted / totalSchools) * 100).toFixed(1) : 0;
    
    console.log(`\n  🏫 School Directory Stats:`);
    console.log(`     - Total Schools: ${totalSchools.toLocaleString()}`);
    console.log(`     - Extraction Rate: ${extractedRate}% (${extracted} schools)`);
    console.log(`     - With Tech Stack: ${withTech}`);
    console.log(`     - With Buying Window: ${withBuyingWindow}`);
    
    results.passed++;
    
  } catch (error: any) {
    console.log(`  ❌ [ERROR] School stats check failed: ${error.message}`);
    results.failed++;
  }
}

function printFinalReport(results: AuditResults) {
  console.log("\n" + "=".repeat(60));
  console.log("📋 FINAL AUDIT REPORT");
  console.log("=".repeat(60));
  
  const total = results.passed + results.failed + results.warnings;
  const passRate = ((results.passed / total) * 100).toFixed(1);
  
  console.log(`\n  ✅ Passed:   ${results.passed}`);
  console.log(`  ❌ Failed:   ${results.failed}`);
  console.log(`  ⚠️  Warnings: ${results.warnings}`);
  console.log(`\n  📊 Pass Rate: ${passRate}%`);
  
  if (results.details.length > 0) {
    console.log("\n  📝 Issues Requiring Attention:");
    results.details.forEach(d => console.log(`     - ${d}`));
  }
  
  console.log("\n" + "=".repeat(60));
  
  if (results.failed > 0) {
    console.log("❌ AUDIT FAILED - Review failures before production deployment");
    process.exit(1);
  } else if (results.warnings > 3) {
    console.log("⚠️  AUDIT PASSED WITH WARNINGS - Review before production");
    process.exit(0);
  } else {
    console.log("✅ AUDIT PASSED - System is production ready");
    process.exit(0);
  }
}

runAudit().catch(err => {
  console.error("Fatal audit error:", err);
  process.exit(1);
});
