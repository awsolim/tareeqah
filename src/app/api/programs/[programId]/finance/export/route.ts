import { requireProgramFinanceAccess } from "@/lib/finance/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

function csvEscape(value: string) {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function GET(request: Request, { params }: { params: Promise<{ programId: string }> }) {
  try {
    const { programId } = await params;
    const authorization = request.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
    if (!token) {
      return Response.json({ error: "Not authenticated." }, { status: 401 });
    }

    const supabase = createSupabaseServiceClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return Response.json({ error: "Not authenticated." }, { status: 401 });
    }

    const access = await requireProgramFinanceAccess(supabase, programId, user.id);
    if (!access.ok) {
      return Response.json({ error: access.error }, { status: access.status });
    }

    const url = new URL(request.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");

    let query = supabase
      .from("program_payments")
      .select("id, student_profile_id, parent_profile_id, amount_cents, currency, paid_at, tax_receipt_status, tax_receipt_eligible_amount_cents, tax_receipt_number")
      .eq("program_id", programId)
      .order("paid_at", { ascending: false });
    if (from) {
      query = query.gte("paid_at", from);
    }
    if (to) {
      query = query.lte("paid_at", to);
    }

    const { data: payments, error: paymentsError } = await query;
    if (paymentsError) {
      return Response.json({ error: paymentsError.message }, { status: 500 });
    }

    const rows = payments ?? [];
    const profileIds = Array.from(
      new Set(rows.flatMap((row) => [row.student_profile_id, row.parent_profile_id]).filter((id): id is string => Boolean(id))),
    );

    const nameById = new Map<string, string>();
    if (profileIds.length) {
      const { data: profileRows } = await supabase.from("profiles").select("id, full_name, email").in("id", profileIds);
      for (const row of profileRows ?? []) {
        nameById.set(row.id, row.full_name || row.email || "");
      }
    }

    const header = ["Date", "Student", "Parent", "Amount", "Currency", "Tax receipt status", "Tax receipt eligible amount", "Tax receipt number"];
    const lines = [header.join(",")];
    for (const row of rows) {
      const line = [
        row.paid_at,
        row.student_profile_id ? nameById.get(row.student_profile_id) ?? "" : "",
        row.parent_profile_id ? nameById.get(row.parent_profile_id) ?? "" : "",
        (row.amount_cents / 100).toFixed(2),
        row.currency,
        row.tax_receipt_status,
        row.tax_receipt_eligible_amount_cents != null ? (row.tax_receipt_eligible_amount_cents / 100).toFixed(2) : "",
        row.tax_receipt_number ?? "",
      ].map((value) => csvEscape(String(value)));
      lines.push(line.join(","));
    }

    const csv = lines.join("\n");
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="payments-${programId}.csv"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not export payments.";
    return Response.json({ error: message }, { status: 500 });
  }
}
