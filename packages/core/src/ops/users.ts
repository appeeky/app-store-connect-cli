import { z } from "zod";
import type { UserRole } from "../types.js";
import { id, page, pageOpts, str, type AscOp } from "./shared.js";

const roles = z
  .array(z.string().min(1))
  .describe("Roles, e.g. ADMIN, APP_MANAGER, DEVELOPER, MARKETING, SALES, FINANCE, CUSTOMER_SUPPORT, ACCESS_TO_REPORTS");
const access = {
  allAppsVisible: z.boolean().optional(),
  provisioningAllowed: z.boolean().optional().describe("May manage certificates, IDs and profiles"),
  visibleAppIds: z.array(z.string()).optional().describe("Apps the user can see when allAppsVisible is false"),
};

export const USER_OPS: AscOp[] = [
  {
    name: "appstore_list_users",
    group: "users",
    summary: "List App Store Connect team members",
    write: false,
    shape: { username: z.string().optional().describe("Apple ID email"), roles: roles.optional(), ...page },
    run: (c, a) =>
      c.users.list({ ...pageOpts(a), username: a.username as string | undefined, roles: a.roles as UserRole[] | undefined }),
  },
  {
    name: "appstore_get_user",
    group: "users",
    summary: "Get a team member with their visible apps",
    write: false,
    shape: { userId: id("User") },
    run: (c, a) => c.users.get(str(a.userId, "userId")),
  },
  {
    name: "appstore_update_user",
    group: "users",
    summary: "Change a team member's roles, app visibility or provisioning access",
    write: true,
    shape: { userId: id("User"), roles: roles.optional(), ...access },
    run: (c, a) =>
      c.users.update(str(a.userId, "userId"), {
        roles: a.roles as UserRole[] | undefined,
        allAppsVisible: a.allAppsVisible as boolean | undefined,
        provisioningAllowed: a.provisioningAllowed as boolean | undefined,
        visibleAppIds: a.visibleAppIds as string[] | undefined,
      }),
  },
  {
    name: "appstore_remove_user",
    group: "users",
    summary: "Remove a team member from App Store Connect",
    write: true,
    shape: { userId: id("User") },
    run: (c, a) => c.users.remove(str(a.userId, "userId")),
  },
  {
    name: "appstore_list_user_invitations",
    group: "users",
    summary: "List pending team invitations",
    write: false,
    shape: { email: z.string().optional(), ...page },
    run: (c, a) => c.users.listInvitations({ ...pageOpts(a), email: a.email as string | undefined }),
  },
  {
    name: "appstore_invite_user",
    group: "users",
    summary: "Invite someone to the App Store Connect team with roles",
    write: true,
    shape: {
      email: z.string().email(),
      firstName: z.string().min(1),
      lastName: z.string().min(1),
      roles: roles.min(1),
      ...access,
    },
    run: (c, a) =>
      c.users.invite({
        email: str(a.email, "email"),
        firstName: str(a.firstName, "firstName"),
        lastName: str(a.lastName, "lastName"),
        roles: a.roles as UserRole[],
        allAppsVisible: a.allAppsVisible as boolean | undefined,
        provisioningAllowed: a.provisioningAllowed as boolean | undefined,
        visibleAppIds: a.visibleAppIds as string[] | undefined,
      }),
  },
  {
    name: "appstore_cancel_user_invitation",
    group: "users",
    summary: "Cancel a pending team invitation",
    write: true,
    shape: { invitationId: id("User invitation") },
    run: (c, a) => c.users.cancelInvitation(str(a.invitationId, "invitationId")),
  },
];
