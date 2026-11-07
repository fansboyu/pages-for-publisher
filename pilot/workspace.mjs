export async function workspaceOverview(db,user){
 const agency=user.role==='admin'?null:user.agency_id;
 const ids=(await db.query('SELECT s.id FROM sites s JOIN clients c ON c.id=s.client_id WHERE ($1::text IS NULL OR c.agency_id=$1)',[agency])).rows.map(s=>s.id);
 const [traffic,articles,spent,available]=await Promise.all([
  db.query("SELECT COALESCE(sum(pageviews),0)::text total FROM site_analytics_daily WHERE site_id=ANY($1::text[]) AND visit_date BETWEEN (now() AT TIME ZONE 'Asia/Shanghai')::date-6 AND (now() AT TIME ZONE 'Asia/Shanghai')::date",[ids]),
  db.query("SELECT count(*)::text total FROM articles WHERE site_id=ANY($1::text[]) AND ai_generated_at>=date_trunc('month',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai' AND ai_generated_at<=now()",[ids]),
  db.query("SELECT COALESCE(sum(CASE WHEN l.kind='charge' THEN l.amount_cents ELSE -l.amount_cents END),0)::text total FROM billing_ledger l JOIN billing_orders o ON o.id=l.order_id WHERE o.site_id=ANY($1::text[]) AND l.kind IN ('charge','refund') AND l.created_at>=date_trunc('month',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'",[ids]),
  db.query('SELECT COALESCE(sum(a.balance_cents-a.held_cents),0)::text total FROM billing_accounts a LEFT JOIN clients c ON c.id=a.client_id WHERE ($1::text IS NULL OR a.agency_id=$1 OR c.agency_id=$1)',[agency])
 ]);
 return {pageviews:Number(traffic.rows[0].total),aiArticles:Number(articles.rows[0].total),spentCents:Number(spent.rows[0].total),availableCents:Number(available.rows[0].total),scope:user.role==='admin'?'全平台':'所属客户',asOf:new Date().toISOString()};
}
