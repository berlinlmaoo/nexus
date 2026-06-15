export type Status = "todo" | "in_progress" | "review" | "done" | "blocked";
export type Priority = "low" | "medium" | "high" | "urgent";

export interface User {
  id: string;
  name: string;
  initials: string;
  color: string;
  role: string;
}

export interface Task {
  id: string;
  title: string;
  status: Status;
  priority: Priority;
  assignee: string;
  projectId: string;
  due: string;
  tags: string[];
  description?: string;
  comments?: number;
  subtasks?: { total: number; done: number };
}

export interface Project {
  id: string;
  name: string;
  key: string;
  emoji: string;
  color: string;
  description: string;
  progress: number;
  status: "on_track" | "at_risk" | "off_track" | "completed";
  members: string[];
  taskCount: number;
  dueDate: string;
}

export interface Goal {
  id: string;
  title: string;
  owner: string;
  progress: number;
  status: "on_track" | "at_risk" | "behind";
  due: string;
  parent?: string;
  metric: string;
}

export interface Doc {
  id: string;
  title: string;
  emoji: string;
  updated: string;
  author: string;
  parent?: string;
  excerpt: string;
}

export interface Notification {
  id: string;
  kind: "mention" | "assigned" | "comment" | "due" | "status";
  actor: string;
  text: string;
  target: string;
  time: string;
  read: boolean;
}

export const users: User[] = [
  { id: "u1", name: "Aria Chen", initials: "AC", color: "#6366f1", role: "Product Lead" },
  { id: "u2", name: "Marcus Webb", initials: "MW", color: "#ec4899", role: "Engineering" },
  { id: "u3", name: "Lina Park", initials: "LP", color: "#10b981", role: "Design" },
  { id: "u4", name: "Diego Romero", initials: "DR", color: "#f59e0b", role: "Engineering" },
  { id: "u5", name: "Yuki Tanaka", initials: "YT", color: "#06b6d4", role: "Marketing" },
  { id: "u6", name: "Sam Olu", initials: "SO", color: "#8b5cf6", role: "Ops" },
  { id: "u7", name: "Priya Shah", initials: "PS", color: "#ef4444", role: "Research" },
];

export const projects: Project[] = [
  { id: "p1", name: "Atlas Platform", key: "ATL", emoji: "🚀", color: "#6366f1", description: "Core platform rebuild — Q2 release", progress: 64, status: "on_track", members: ["u1","u2","u3","u4"], taskCount: 48, dueDate: "Jun 28" },
  { id: "p2", name: "Brand Refresh", key: "BR", emoji: "🎨", color: "#ec4899", description: "New visual identity & website", progress: 38, status: "at_risk", members: ["u3","u5","u1"], taskCount: 26, dueDate: "Jul 12" },
  { id: "p3", name: "Mobile App v3", key: "MOB", emoji: "📱", color: "#10b981", description: "iOS + Android rewrite in React Native", progress: 22, status: "on_track", members: ["u2","u4","u6"], taskCount: 71, dueDate: "Aug 30" },
  { id: "p4", name: "Customer Research", key: "RES", emoji: "🔬", color: "#f59e0b", description: "Q3 interview cycle & insights", progress: 81, status: "on_track", members: ["u7","u1"], taskCount: 19, dueDate: "Jun 14" },
  { id: "p5", name: "Onboarding Funnel", key: "ONB", emoji: "✨", color: "#06b6d4", description: "Reduce activation drop-off", progress: 50, status: "on_track", members: ["u5","u3","u2"], taskCount: 33, dueDate: "Jul 5" },
  { id: "p6", name: "Compliance & SOC2", key: "SOC", emoji: "🛡️", color: "#8b5cf6", description: "Audit-readiness sprint", progress: 12, status: "off_track", members: ["u6","u4"], taskCount: 42, dueDate: "Sep 20" },
];

export const tasks: Task[] = [
  { id: "t1", title: "Design new pricing page hero", status: "in_progress", priority: "high", assignee: "u3", projectId: "p2", due: "Today", tags: ["design","web"], comments: 4, subtasks: { total: 5, done: 2 } },
  { id: "t2", title: "API rate limiting middleware", status: "todo", priority: "urgent", assignee: "u2", projectId: "p1", due: "Tomorrow", tags: ["backend"], comments: 2, subtasks: { total: 3, done: 0 } },
  { id: "t3", title: "Interview 5 power users", status: "review", priority: "medium", assignee: "u7", projectId: "p4", due: "Fri", tags: ["research"], comments: 8 },
  { id: "t4", title: "Push notifications schema", status: "in_progress", priority: "high", assignee: "u4", projectId: "p3", due: "Jun 10", tags: ["mobile","backend"], comments: 1, subtasks: { total: 4, done: 3 } },
  { id: "t5", title: "Activation email sequence", status: "todo", priority: "medium", assignee: "u5", projectId: "p5", due: "Jun 8", tags: ["growth"], comments: 0 },
  { id: "t6", title: "SOC2 access review", status: "blocked", priority: "urgent", assignee: "u6", projectId: "p6", due: "Overdue", tags: ["compliance"], comments: 12 },
  { id: "t7", title: "Animate dashboard charts", status: "done", priority: "low", assignee: "u3", projectId: "p1", due: "Last week", tags: ["frontend"], comments: 3 },
  { id: "t8", title: "Logo lockup variants", status: "in_progress", priority: "medium", assignee: "u3", projectId: "p2", due: "Jun 6", tags: ["design"] },
  { id: "t9", title: "Bottom sheet component", status: "review", priority: "high", assignee: "u4", projectId: "p3", due: "Jun 9", tags: ["mobile"] },
  { id: "t10", title: "Synthesize Q2 insights", status: "todo", priority: "high", assignee: "u7", projectId: "p4", due: "Jun 11", tags: ["research"] },
  { id: "t11", title: "Trial CTA A/B test", status: "in_progress", priority: "medium", assignee: "u5", projectId: "p5", due: "Jun 12", tags: ["growth"] },
  { id: "t12", title: "Vendor security questionnaire", status: "todo", priority: "low", assignee: "u6", projectId: "p6", due: "Jun 20", tags: ["compliance"] },
  { id: "t13", title: "Refactor auth provider", status: "done", priority: "high", assignee: "u2", projectId: "p1", due: "May 30", tags: ["backend"] },
  { id: "t14", title: "Marketing site copy review", status: "review", priority: "low", assignee: "u5", projectId: "p2", due: "Jun 7", tags: ["copy"] },
  { id: "t15", title: "Offline mode spike", status: "todo", priority: "medium", assignee: "u4", projectId: "p3", due: "Jun 18", tags: ["mobile","spike"] },
];

export const goals: Goal[] = [
  { id: "g1", title: "Ship Atlas v2 to GA", owner: "u1", progress: 64, status: "on_track", due: "Q2", metric: "Launch readiness" },
  { id: "g2", title: "Reduce activation drop-off by 30%", owner: "u5", progress: 42, status: "at_risk", due: "Q2", metric: "Day-1 retention" },
  { id: "g3", title: "Mobile DAU > 50k", owner: "u4", progress: 22, status: "on_track", due: "Q3", metric: "DAU", parent: "g1" },
  { id: "g4", title: "SOC2 Type II report", owner: "u6", progress: 12, status: "behind", due: "Q3", metric: "Audit completion" },
  { id: "g5", title: "NPS > 55", owner: "u7", progress: 78, status: "on_track", due: "Q2", metric: "NPS" },
];

export const docs: Doc[] = [
  { id: "d1", title: "Engineering Handbook", emoji: "📘", updated: "2h ago", author: "u2", excerpt: "How we ship, review, and operate at Nexus." },
  { id: "d2", title: "Brand Guidelines 2026", emoji: "🎨", updated: "Yesterday", author: "u3", excerpt: "Voice, color, typography, motion." },
  { id: "d3", title: "Q2 OKRs", emoji: "🎯", updated: "3d ago", author: "u1", excerpt: "Objectives and key results for the quarter." },
  { id: "d4", title: "Incident Response Playbook", emoji: "🚨", updated: "1w ago", author: "u2", excerpt: "Severity levels, comms, postmortems." },
  { id: "d5", title: "Customer Interview Library", emoji: "🗣️", updated: "5h ago", author: "u7", excerpt: "Themes and quotes from 120+ interviews." },
  { id: "d6", title: "Atlas Architecture", emoji: "🏛️", updated: "4d ago", author: "u4", parent: "d1", excerpt: "Services, data flow, deployment topology." },
];

export const notifications: Notification[] = [
  { id: "n1", kind: "mention", actor: "u2", text: "mentioned you in", target: "API rate limiting middleware", time: "12m", read: false },
  { id: "n2", kind: "assigned", actor: "u1", text: "assigned to you", target: "Q2 review prep", time: "1h", read: false },
  { id: "n3", kind: "comment", actor: "u3", text: "commented on", target: "Design new pricing page hero", time: "2h", read: false },
  { id: "n4", kind: "due", actor: "u1", text: "task due tomorrow", target: "API rate limiting middleware", time: "3h", read: true },
  { id: "n5", kind: "status", actor: "u4", text: "moved to Review", target: "Bottom sheet component", time: "4h", read: true },
  { id: "n6", kind: "mention", actor: "u7", text: "mentioned you in", target: "Q2 insights synthesis", time: "Yesterday", read: true },
  { id: "n7", kind: "assigned", actor: "u6", text: "assigned to you", target: "SOC2 access review", time: "Yesterday", read: true },
];

export const userById = (id: string) => users.find((u) => u.id === id)!;
export const projectSlug = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
export const projectById = (id: string) =>
  projects.find((p) => p.id === id || p.key.toLowerCase() === id || projectSlug(p.name) === id) ?? projects[0]!;

export const statusMeta: Record<Status, { label: string; color: string; dot: string }> = {
  todo: { label: "To do", color: "bg-muted text-muted-foreground", dot: "bg-muted-foreground/60" },
  in_progress: { label: "In progress", color: "bg-info/15 text-info", dot: "bg-info" },
  review: { label: "In review", color: "bg-warning/20 text-warning-foreground", dot: "bg-warning" },
  done: { label: "Done", color: "bg-success/15 text-success", dot: "bg-success" },
  blocked: { label: "Blocked", color: "bg-destructive/15 text-destructive", dot: "bg-destructive" },
};

export const priorityMeta: Record<Priority, { label: string; color: string }> = {
  low: { label: "Low", color: "text-muted-foreground" },
  medium: { label: "Medium", color: "text-info" },
  high: { label: "High", color: "text-warning-foreground" },
  urgent: { label: "Urgent", color: "text-destructive" },
};
