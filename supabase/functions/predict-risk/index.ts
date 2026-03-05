import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableApiKey) throw new Error("LOVABLE_API_KEY not configured");

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify caller is instructor
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!);
    const { data: { user }, error: authError } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) throw new Error("Unauthorized");

    const { data: roleCheck } = await supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "instructor").single();
    if (!roleCheck) throw new Error("Only instructors can generate predictions");

    const { subject_id } = await req.json();
    if (!subject_id) throw new Error("subject_id is required");

    // 1. Get enrolled students
    const { data: enrollments } = await supabase
      .from("enrollments")
      .select("student_id")
      .eq("subject_id", subject_id)
      .eq("status", "active");

    if (!enrollments?.length) {
      return new Response(JSON.stringify({ error: "No enrolled students found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const studentIds = enrollments.map((e) => e.student_id).filter(Boolean) as string[];

    // 2. Get profiles
    const { data: profiles } = await supabase.from("profiles").select("user_id, full_name").in("user_id", studentIds);
    const profileMap = Object.fromEntries((profiles || []).map((p) => [p.user_id, p.full_name]));

    // 3. Get attendance records for this subject
    const { data: attendance } = await supabase
      .from("attendance")
      .select("student_id, status")
      .eq("subject_id", subject_id);

    // 4. Get activities for this subject
    const { data: activities } = await supabase
      .from("activities")
      .select("id, type, max_score, weight")
      .eq("subject_id", subject_id);

    const activityIds = (activities || []).map((a) => a.id);

    // 5. Get submissions
    let submissions: any[] = [];
    if (activityIds.length > 0) {
      const { data } = await supabase
        .from("submissions")
        .select("student_id, activity_id, score")
        .in("activity_id", activityIds);
      submissions = data || [];
    }

    // 6. Compute metrics per student
    const studentMetrics = studentIds.map((sid) => {
      const studentAttendance = (attendance || []).filter((a) => a.student_id === sid);
      const totalClasses = studentAttendance.length;
      const presentCount = studentAttendance.filter((a) => a.status === "present" || a.status === "late").length;
      const attendanceRate = totalClasses > 0 ? presentCount / totalClasses : null;

      const studentSubs = submissions.filter((s) => s.student_id === sid);
      const activityMap: Record<string, { score: number; max: number; type: string }[]> = {};
      for (const sub of studentSubs) {
        const act = (activities || []).find((a) => a.id === sub.activity_id);
        if (!act || sub.score == null) continue;
        if (!activityMap[act.type]) activityMap[act.type] = [];
        activityMap[act.type].push({ score: sub.score, max: act.max_score, type: act.type });
      }

      const avg = (items: { score: number; max: number }[]) =>
        items.length > 0 ? items.reduce((s, i) => s + (i.score / i.max) * 100, 0) / items.length : null;

      const quizAvg = avg(activityMap["quiz"] || []);
      const assignmentAvg = avg(activityMap["assignment"] || []);
      const projectScore = avg(activityMap["project"] || []);
      const examAvg = avg(activityMap["exam"] || []);

      const totalActivities = (activities || []).length;
      const completedActivities = studentSubs.filter((s) => s.score != null).length;
      const completionRate = totalActivities > 0 ? completedActivities / totalActivities : null;

      return {
        student_id: sid,
        name: profileMap[sid] || "Unknown",
        attendance_rate: attendanceRate,
        quiz_average: quizAvg,
        assignment_average: assignmentAvg,
        project_score: projectScore,
        exam_average: examAvg,
        activity_completion_rate: completionRate,
      };
    });

    // 7. Call Lovable AI for classification
    const prompt = `You are an academic risk assessment AI for a higher education system called EDGE (Early Detection for Graduation Enhancement).

Analyze each student's metrics and classify their risk level. Return a JSON array using the tool provided.

Metrics for each student:
${JSON.stringify(studentMetrics, null, 2)}

Classification guidelines:
- "at_risk": attendance < 70%, OR multiple averages below 60%, OR completion rate < 50%
- "stable": metrics are moderate (60-80% range), no critical flags
- "excelling": attendance > 90%, averages > 85%, high completion

If data is insufficient (null values), note that in the recommendation and classify as "stable" by default.
For each student provide a specific, actionable recommendation.`;

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "user", content: prompt }],
        tools: [
          {
            type: "function",
            function: {
              name: "classify_students",
              description: "Classify students by risk level with recommendations",
              parameters: {
                type: "object",
                properties: {
                  predictions: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        student_id: { type: "string" },
                        risk_level: { type: "string", enum: ["at_risk", "stable", "excelling"] },
                        confidence: { type: "number", description: "0 to 1" },
                        recommendation: { type: "string" },
                      },
                      required: ["student_id", "risk_level", "confidence", "recommendation"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["predictions"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "classify_students" } },
      }),
    });

    if (!aiResponse.ok) {
      const status = aiResponse.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI credits depleted. Please add funds in Settings → Workspace → Usage." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await aiResponse.text();
      console.error("AI error:", status, errText);
      throw new Error("AI classification failed");
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No tool call in AI response");

    const { predictions: aiPredictions } = JSON.parse(toolCall.function.arguments);

    // 8. Delete old predictions for this subject, then insert new ones
    await supabase.from("predictions").delete().eq("subject_id", subject_id);

    const rows = aiPredictions.map((p: any) => {
      const metrics = studentMetrics.find((m) => m.student_id === p.student_id);
      return {
        student_id: p.student_id,
        subject_id,
        prediction_type: "ai_classification",
        risk_level: p.risk_level,
        confidence: p.confidence,
        recommendation: p.recommendation,
        attendance_rate: metrics?.attendance_rate,
        quiz_average: metrics?.quiz_average,
        assignment_average: metrics?.assignment_average,
        project_score: metrics?.project_score,
        activity_completion_rate: metrics?.activity_completion_rate,
      };
    });

    const { error: insertError } = await supabase.from("predictions").insert(rows);
    if (insertError) throw insertError;

    return new Response(JSON.stringify({ success: true, count: rows.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("predict-risk error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
