import {
  LayoutDashboard, Inbox, MessageCircle, CheckSquare, Calendar, CalendarClock, FolderKanban,
  Trophy, ClipboardCheck, Settings, Shield, FileText, AtSign, Ticket, HardDrive, Scale,
} from "lucide-react";
import { GideonMark } from "@/components/gideon/GideonMark";

/**
 * The navigation groups, ONE list for the desktop sidebar and the phone's More sheet (UI tour run 20, R20-WM-1:
 * the sheet kept the old grouping after the owner's sidebar change of 16 Oct 2026).
 */
export const navGroups = [
  {
    label: "Home",
    items: [
      { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
      { title: "Messages", url: "/messages", icon: MessageCircle },
      // GIDEON full page (12 Oct 2026, Notion AI's chat page): conversations with search.
      { title: "GIDEON", url: "/gideon", icon: GideonMark },
      { title: "Notifications", url: "/inbox", icon: Inbox },
      { title: "My Tasks", url: "/my-tasks", icon: CheckSquare },
      { title: "My Submissions", url: "/submissions", icon: FileText },
      { title: "Calendar", url: "/calendar", icon: Calendar },
      { title: "Attendance", url: "/attendance", icon: ClipboardCheck },
    ],
  },
  {
    label: "Work",
    items: [
      { title: "Projects", url: "/projects", icon: FolderKanban },
      // Invitation only (owner, 14 Oct 2026): shown when canAccessLegal; the server refuses everyone else.
      { title: "Legal", url: "/legal", icon: Scale },
      { title: "Leaderboard", url: "/leaderboard", icon: Trophy },
    ],
  },
  {
    label: "Team",
    items: [
      { title: "Z Vault", url: "/vault", icon: HardDrive },
      { title: "Threads", url: "/threads", icon: AtSign },
      { title: "Room Booking", url: "/room-booking", icon: CalendarClock },
    ],
  },
  {
    label: "System",
    items: [
      { title: "Tickets", url: "/complaints", icon: Ticket },
      { title: "Settings", url: "/settings", icon: Settings },
      { title: "Control Room", url: "/admin", icon: Shield },
    ],
  },
] as const;
