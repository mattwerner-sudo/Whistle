#!/usr/bin/env bash
# Queue N pending schools for extraction and wait for the queue to drain.
# Usage: scripts/run-batch.sh [batch_size] [base_url]
set -uo pipefail
cd "$(dirname "$0")/.."

BATCH_SIZE="${1:-30}"
BASE="${2:-http://localhost:5001}"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [[ -z "${DATABASE_URL:-}" || -z "${ADMIN_SECRET:-}" ]]; then
  echo "DATABASE_URL and ADMIN_SECRET must be set (source .env)." >&2
  exit 1
fi

if ! curl -s -o /dev/null -m 3 "$BASE/health"; then
  echo "Server not reachable at $BASE. Start it first (npm run dev)." >&2
  exit 1
fi

SCHOOLS=$(node -e "
require('dotenv/config');
const {Pool}=require('pg');
const p=new Pool({connectionString:process.env.DATABASE_URL});
(async()=>{
  const r=await p.query('select school_id from school_directories where status=\$1 order by school_id limit \$2', ['pending', $BATCH_SIZE]);
  console.log(r.rows.map(x=>x.school_id).join('\n'));
  await p.end();
})();
" 2>/dev/null | grep -v "^$")

COUNT=$(echo "$SCHOOLS" | grep -c . || true)
if [[ "$COUNT" -eq 0 ]]; then
  echo "No pending schools left."
  exit 0
fi
echo "Queuing $COUNT school(s)..."

while IFS= read -r s; do
  [[ -z "$s" ]] && continue
  curl -s -o /dev/null -X POST "$BASE/api/staff/extract/$s" -H "Content-Type: application/json" -d '{}'
done <<< "$SCHOOLS"

echo "Waiting for queue to drain..."
for i in $(seq 1 120); do
  ACTIVE=$(curl -s "$BASE/api/jobs/queue/status" -H "X-Admin-Secret: $ADMIN_SECRET" 2>/dev/null \
    | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).activeCount)}catch{console.log('?')}})" 2>/dev/null)
  echo "  [$i] active: $ACTIVE"
  [[ "$ACTIVE" == "0" ]] && break
  sleep 10
done

echo
echo "Batch results:"
node -e "
require('dotenv/config');
const {Pool}=require('pg');
const p=new Pool({connectionString:process.env.DATABASE_URL});
(async()=>{
  const ids = \`$SCHOOLS\`.split('\n').filter(Boolean);
  const r=await p.query('select status, count(*) from school_directories where school_id = any(\$1) group by status', [ids]);
  console.log(r.rows);
  const overall=await p.query('select status, count(*) from school_directories group by status order by status');
  console.log('overall:', overall.rows);
  await p.end();
})();
" 2>/dev/null
