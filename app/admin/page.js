"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const SIDEBAR_W = 240;
const ACCENT = "#6C5CE7";

function StatCard({ label, value, sub }) {
  return (
    <div style={{
      background: "#fff",
      border: "1px solid #e8e8ec",
      borderRadius: 8,
      padding: "20px 24px",
    }}>
      <div style={{ fontSize: 12, color: "#888", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 32, fontWeight: 700, color: "#1a1a2e" }}>
        {value ?? "—"}
      </div>
      {sub && <div style={{ fontSize: 12, color: "#aaa", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// Placeholder purchases data
const PLACEHOLDER_PURCHASES = [
  { email: "sarah.j@example.com", plan: "Builder", date: "2026-03-28", amount: "€7.00", status: "Completed" },
  { email: "mike.r@example.com", plan: "Unlimited", date: "2026-03-25", amount: "€12.00/mo", status: "Active" },
  { email: "alex.k@example.com", plan: "Starter", date: "2026-03-20", amount: "€3.00", status: "Completed" },
];

export default function AdminDashboard() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("dashboard");
  const [stats, setStats] = useState(null);
  const [subscribers, setSubscribers] = useState([]);
  const [pushTitle, setPushTitle] = useState("");
  const [pushBody, setPushBody] = useState("");
  const [pushUrl, setPushUrl] = useState("");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState(null);
  const [confirmSend, setConfirmSend] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Auth check
  useEffect(() => {
    fetch("/api/admin/auth")
      .then(r => r.json())
      .then(d => {
        if (!d.authenticated) router.push("/admin/login");
        else setAuthed(true);
      })
      .catch(() => router.push("/admin/login"))
      .finally(() => setLoading(false));
  }, [router]);

  // Load data
  useEffect(() => {
    if (!authed) return;
    fetch("/api/admin/stats").then(r => r.json()).then(setStats).catch(() => {});
    fetch("/api/admin/subscribers").then(r => r.json()).then(d => setSubscribers(Array.isArray(d) ? d : [])).catch(() => {});
  }, [authed]);

  const handleLogout = async () => {
    await fetch("/api/admin/auth", { method: "DELETE" });
    router.push("/admin/login");
  };

  const handleSend = async () => {
    if (!pushTitle.trim() || !pushBody.trim()) return;
    setSending(true);
    setSendResult(null);
    try {
      const res = await fetch("/api/admin/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: pushTitle, body: pushBody, url: pushUrl || undefined }),
      });
      const data = await res.json();
      setSendResult(data);
      if (data.sent > 0) {
        setPushTitle("");
        setPushBody("");
        setPushUrl("");
      }
    } catch (e) {
      setSendResult({ error: e.message });
    }
    setSending(false);
    setConfirmSend(false);
  };

  if (loading || !authed) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f5f5f7", fontFamily: FONT }}>
        <div style={{ color: "#888", fontSize: 14 }}>Loading...</div>
      </div>
    );
  }

  const navItems = [
    { id: "dashboard", label: "Dashboard" },
    { id: "push", label: "Push Notifications" },
    { id: "purchases", label: "Purchases" },
  ];

  const sidebar = (
    <div style={{
      width: isMobile ? "100%" : SIDEBAR_W,
      background: "#1a1a2e",
      color: "#fff",
      display: "flex",
      flexDirection: isMobile ? "row" : "column",
      padding: isMobile ? "0" : "24px 0",
      flexShrink: 0,
      ...(isMobile ? { borderBottom: "1px solid rgba(255,255,255,0.1)" } : { minHeight: "100vh" }),
    }}>
      {!isMobile && (
        <div style={{ padding: "0 20px 24px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Paso Admin</div>
        </div>
      )}
      <nav style={{
        display: "flex",
        flexDirection: isMobile ? "row" : "column",
        flex: 1,
        padding: isMobile ? "0" : "12px 0",
        ...(isMobile ? { overflowX: "auto" } : {}),
      }}>
        {navItems.map(item => (
          <button
            key={item.id}
            onClick={() => setTab(item.id)}
            style={{
              background: tab === item.id ? "rgba(108,92,231,0.15)" : "transparent",
              border: "none",
              color: tab === item.id ? "#fff" : "rgba(255,255,255,0.5)",
              fontSize: 13,
              fontWeight: tab === item.id ? 600 : 400,
              padding: isMobile ? "14px 18px" : "10px 20px",
              textAlign: "left",
              cursor: "pointer",
              transition: "all 0.15s ease",
              borderLeft: !isMobile && tab === item.id ? `3px solid ${ACCENT}` : !isMobile ? "3px solid transparent" : "none",
              borderBottom: isMobile && tab === item.id ? `2px solid ${ACCENT}` : isMobile ? "2px solid transparent" : "none",
              whiteSpace: "nowrap",
              fontFamily: FONT,
            }}
          >
            {item.label}
          </button>
        ))}
      </nav>
      {!isMobile && (
        <div style={{ padding: "12px 20px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <button onClick={handleLogout} style={{
            background: "none", border: "none", color: "rgba(255,255,255,0.4)", fontSize: 12,
            cursor: "pointer", fontFamily: FONT,
          }}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div style={{
      display: "flex",
      flexDirection: isMobile ? "column" : "row",
      minHeight: "100vh",
      fontFamily: FONT,
      background: "#f5f5f7",
    }}>
      {sidebar}

      <main style={{ flex: 1, padding: isMobile ? "20px" : "32px 40px", overflowY: "auto" }}>
        {/* ─── DASHBOARD TAB ─── */}
        {tab === "dashboard" && (
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: "#1a1a2e", marginBottom: 24 }}>Dashboard</h1>
            <div style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 16,
              marginBottom: 32,
            }}>
              <StatCard label="Total Users" value={stats?.total_users} />
              <StatCard label="Active (7d)" value={stats?.active_7d} sub="New roadmaps" />
              <StatCard label="Active (30d)" value={stats?.active_30d} sub="New roadmaps" />
              <StatCard label="Push Subscribers" value={stats?.push_subscribers} />
              <StatCard label="Started Progress" value={stats?.users_with_progress} sub="1+ milestone checked" />
            </div>

            {isMobile && (
              <button onClick={handleLogout} style={{
                background: "none", border: "1px solid #ddd", borderRadius: 8,
                padding: "10px 16px", fontSize: 13, color: "#888", cursor: "pointer",
                fontFamily: FONT, marginTop: 16,
              }}>
                Sign out
              </button>
            )}
          </div>
        )}

        {/* ─── PUSH NOTIFICATIONS TAB ─── */}
        {tab === "push" && (
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: "#1a1a2e", marginBottom: 24 }}>Push Notifications</h1>

            {/* Compose */}
            <div style={{
              background: "#fff", border: "1px solid #e8e8ec", borderRadius: 8,
              padding: 24, marginBottom: 24,
            }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Send Notification</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <input
                  value={pushTitle} onChange={e => setPushTitle(e.target.value)}
                  placeholder="Title" maxLength={100}
                  style={{ padding: "10px 14px", border: "1px solid #ddd", borderRadius: 6, fontSize: 14, outline: "none", fontFamily: FONT }}
                />
                <textarea
                  value={pushBody} onChange={e => setPushBody(e.target.value)}
                  placeholder="Message body" rows={3} maxLength={500}
                  style={{ padding: "10px 14px", border: "1px solid #ddd", borderRadius: 6, fontSize: 14, outline: "none", resize: "vertical", fontFamily: FONT }}
                />
                <input
                  value={pushUrl} onChange={e => setPushUrl(e.target.value)}
                  placeholder="URL to open on tap (optional)"
                  style={{ padding: "10px 14px", border: "1px solid #ddd", borderRadius: 6, fontSize: 14, outline: "none", fontFamily: FONT }}
                />

                {!confirmSend ? (
                  <button
                    onClick={() => setConfirmSend(true)}
                    disabled={!pushTitle.trim() || !pushBody.trim()}
                    style={{
                      padding: "12px 24px", borderRadius: 6, border: "none",
                      background: pushTitle.trim() && pushBody.trim() ? ACCENT : "#ccc",
                      color: "#fff", fontSize: 14, fontWeight: 600, cursor: pushTitle.trim() && pushBody.trim() ? "pointer" : "not-allowed",
                      fontFamily: FONT,
                    }}
                  >
                    Send to all subscribers ({subscribers.length})
                  </button>
                ) : (
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <button
                      onClick={handleSend}
                      disabled={sending}
                      style={{
                        padding: "12px 24px", borderRadius: 6, border: "none",
                        background: "#e74c3c", color: "#fff", fontSize: 14, fontWeight: 600,
                        cursor: sending ? "not-allowed" : "pointer", fontFamily: FONT,
                      }}
                    >
                      {sending ? "Sending..." : `Confirm — send to ${subscribers.length} users`}
                    </button>
                    <button
                      onClick={() => setConfirmSend(false)}
                      style={{ padding: "12px 16px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", fontSize: 14, cursor: "pointer", fontFamily: FONT }}
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {sendResult && (
                  <div style={{
                    padding: "12px 16px", borderRadius: 6,
                    background: sendResult.error ? "#fef2f2" : "#f0fdf4",
                    border: sendResult.error ? "1px solid #fca5a5" : "1px solid #86efac",
                    fontSize: 13,
                  }}>
                    {sendResult.error
                      ? `Error: ${sendResult.error}`
                      : `Sent to ${sendResult.sent} users, ${sendResult.failed} failed (${sendResult.total} total)`
                    }
                  </div>
                )}
              </div>
            </div>

            {/* Subscriber list */}
            <div style={{
              background: "#fff", border: "1px solid #e8e8ec", borderRadius: 8,
              padding: 24,
            }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>
                Subscribers ({subscribers.length})
              </h2>
              {subscribers.length === 0 ? (
                <div style={{ color: "#888", fontSize: 13 }}>No push subscribers yet.</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid #eee" }}>
                        <th style={{ textAlign: "left", padding: "8px 12px", color: "#888", fontWeight: 500 }}>Name / ID</th>
                        <th style={{ textAlign: "left", padding: "8px 12px", color: "#888", fontWeight: 500 }}>Goal</th>
                        <th style={{ textAlign: "left", padding: "8px 12px", color: "#888", fontWeight: 500 }}>Frequency</th>
                        <th style={{ textAlign: "left", padding: "8px 12px", color: "#888", fontWeight: 500 }}>Last Nudge</th>
                        <th style={{ textAlign: "left", padding: "8px 12px", color: "#888", fontWeight: 500 }}>Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {subscribers.map(s => (
                        <tr key={s.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
                          <td style={{ padding: "10px 12px" }}>{s.user_name || s.id}</td>
                          <td style={{ padding: "10px 12px", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.goal}</td>
                          <td style={{ padding: "10px 12px" }}>{s.nudge_frequency || "weekly"}</td>
                          <td style={{ padding: "10px 12px", color: "#888" }}>
                            {s.nudge_last_sent ? new Date(s.nudge_last_sent).toLocaleDateString() : "Never"}
                          </td>
                          <td style={{ padding: "10px 12px", color: "#888" }}>
                            {new Date(s.created_at).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── PURCHASES TAB ─── */}
        {tab === "purchases" && (
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: "#1a1a2e", marginBottom: 8 }}>Purchases</h1>
            <p style={{ fontSize: 13, color: "#888", marginBottom: 24 }}>
              Wire in Stripe webhook data here. Placeholder data shown below.
            </p>

            <div style={{
              background: "#fff", border: "1px solid #e8e8ec", borderRadius: 8,
              padding: 24,
            }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #eee" }}>
                      <th style={{ textAlign: "left", padding: "8px 12px", color: "#888", fontWeight: 500 }}>Email</th>
                      <th style={{ textAlign: "left", padding: "8px 12px", color: "#888", fontWeight: 500 }}>Plan</th>
                      <th style={{ textAlign: "left", padding: "8px 12px", color: "#888", fontWeight: 500 }}>Date</th>
                      <th style={{ textAlign: "left", padding: "8px 12px", color: "#888", fontWeight: 500 }}>Amount</th>
                      <th style={{ textAlign: "left", padding: "8px 12px", color: "#888", fontWeight: 500 }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PLACEHOLDER_PURCHASES.map((p, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #f5f5f5" }}>
                        <td style={{ padding: "10px 12px" }}>{p.email}</td>
                        <td style={{ padding: "10px 12px" }}>
                          <span style={{
                            padding: "3px 8px", borderRadius: 4, fontSize: 11, fontWeight: 500,
                            background: p.plan === "Unlimited" ? "rgba(108,92,231,0.1)" : p.plan === "Builder" ? "rgba(85,239,196,0.1)" : "rgba(26,26,46,0.05)",
                            color: p.plan === "Unlimited" ? ACCENT : p.plan === "Builder" ? "#00b894" : "#666",
                          }}>
                            {p.plan}
                          </span>
                        </td>
                        <td style={{ padding: "10px 12px", color: "#888" }}>{p.date}</td>
                        <td style={{ padding: "10px 12px", fontWeight: 500 }}>{p.amount}</td>
                        <td style={{ padding: "10px 12px" }}>
                          <span style={{
                            padding: "3px 8px", borderRadius: 4, fontSize: 11, fontWeight: 500,
                            background: p.status === "Active" ? "rgba(85,239,196,0.1)" : "rgba(26,26,46,0.05)",
                            color: p.status === "Active" ? "#00b894" : "#888",
                          }}>
                            {p.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{
                marginTop: 20, padding: "14px 16px", borderRadius: 6,
                background: "#f8f8fa", border: "1px dashed #ddd", fontSize: 12, color: "#888",
              }}>
                To wire in real purchase data: set up a Stripe webhook pointing to <code>/api/admin/stripe-webhook</code>,
                store events in a <code>purchases</code> table in Supabase, then query that table here.
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
