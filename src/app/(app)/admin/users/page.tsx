import { UserManagementPage } from "@/components/admin/user-management-page"
import { requireAdminPageAccess } from "@/lib/admin-access"

export const dynamic = "force-dynamic"

export default async function AdminUsersPage() {
  const { context } = await requireAdminPageAccess()

  return (
    <UserManagementPage
      currentUserName={context.user?.name || "Admin"}
    />
  )
}
