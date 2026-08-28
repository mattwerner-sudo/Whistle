import { ParserFactory } from '../server/lib/parser-factory';
import { GOLDEN_SET } from './golden-data';

async function runParserFactoryTests() {
  console.log('============================================================');
  console.log('ParserFactory Regression Tests');
  console.log('============================================================\n');

  let passed = 0;
  let failed = 0;
  let partial = 0;

  for (const testCase of GOLDEN_SET) {
    const parser = new ParserFactory(testCase.html, 'https://test.example.com/staff');
    const result = await parser.parse();
    const strategy = parser.getStrategyName();

    const contact = result.contacts[0] || null;

    const expectNoContact = testCase.expected.email === null;

    if (expectNoContact) {
      if (contact === null || !contact.email) {
        console.log(`  ✅ PASS [${strategy}] ${testCase.name} (correctly returned no contact)`);
        passed++;
      } else {
        console.log(`  ❌ FAIL [${strategy}] ${testCase.name}`);
        console.log(`    Expected no contact but got email: "${contact.email}"`);
        failed++;
      }
      continue;
    }

    if (!contact) {
      console.log(`  ❌ FAIL [${strategy}] ${testCase.name}`);
      console.log(`    No contact extracted (expected email: ${testCase.expected.email})`);
      console.log(`    Diagnostics: containers=${result.diagnostics.containersDetected}, emails=${result.diagnostics.totalEmailLinksFound}`);
      failed++;
      continue;
    }

    const nameMatch = contact.name === testCase.expected.name;
    const emailMatch = contact.email === testCase.expected.email;
    const titleMatch = testCase.expected.title === undefined || contact.title === testCase.expected.title;

    const issues: string[] = [];
    if (!nameMatch) issues.push(`Name: got "${contact.name}", expected "${testCase.expected.name}"`);
    if (!emailMatch) issues.push(`Email: got "${contact.email}", expected "${testCase.expected.email}"`);
    if (!titleMatch) issues.push(`Title: got "${contact.title}", expected "${testCase.expected.title}"`);

    if (issues.length === 0) {
      console.log(`  ✅ PASS [${strategy}] ${testCase.name}`);
      passed++;
    } else if (emailMatch) {
      console.log(`  ⚠️  PARTIAL [${strategy}] ${testCase.name}`);
      issues.forEach(i => console.log(`    ${i}`));
      partial++;
    } else {
      console.log(`  ❌ FAIL [${strategy}] ${testCase.name}`);
      issues.forEach(i => console.log(`    ${i}`));
      failed++;
    }
  }

  console.log('\n============================================================');
  console.log(`Results: ${passed} passed, ${partial} partial, ${failed} failed (${GOLDEN_SET.length} total)`);
  console.log(`Pass Rate: ${((passed / GOLDEN_SET.length) * 100).toFixed(1)}%`);
  console.log('============================================================');

  if (failed > 0) {
    process.exitCode = 1;
  }
}

runParserFactoryTests().catch((err) => {
  console.error('Test runner error:', err);
  process.exitCode = 1;
});
