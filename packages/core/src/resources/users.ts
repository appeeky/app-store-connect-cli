import type { AppStoreConnectClient } from "../client.js";
import { ValidationError } from "../errors.js";
import { compact, enc, listQuery, relMany, type ListOptions } from "../jsonapi.js";
import type { Schemas, UserRole } from "../types.js";

export interface UserAccess {
  roles?: UserRole[];
  allAppsVisible?: boolean;
  provisioningAllowed?: boolean;
  /** App ids the user can see when allAppsVisible is false. */
  visibleAppIds?: string[];
}

export class UsersApi {
  constructor(private readonly client: AppStoreConnectClient) {}

  list(options: ListOptions & { username?: string; roles?: UserRole[] } = {}) {
    return this.client.list(
      "/v1/users",
      listQuery(options, { username: options.username, roles: options.roles }),
      options,
    );
  }

  get(userId: string) {
    return this.client.get(`/v1/users/${enc(userId)}`, { include: ["visibleApps"] });
  }

  update(userId: string, access: UserAccess) {
    const body = {
      data: {
        type: "users",
        id: userId,
        attributes: compact({
          roles: access.roles,
          allAppsVisible: access.allAppsVisible,
          provisioningAllowed: access.provisioningAllowed,
        }),
        ...(access.visibleAppIds ? { relationships: { visibleApps: relMany("apps", access.visibleAppIds) } } : {}),
      },
    } satisfies Schemas["UserUpdateRequest"];
    return this.client.patch(`/v1/users/${enc(userId)}`, body, "users.update");
  }

  remove(userId: string) {
    return this.client.delete(`/v1/users/${enc(userId)}`, undefined, "users.delete");
  }

  listInvitations(options: ListOptions & { email?: string; roles?: UserRole[] } = {}) {
    return this.client.list(
      "/v1/userInvitations",
      listQuery(options, { email: options.email, roles: options.roles }),
      options,
    );
  }

  invite(input: { email: string; firstName: string; lastName: string } & UserAccess) {
    if (!input.roles?.length) throw new ValidationError("Invitations need at least one role");
    const body = {
      data: {
        type: "userInvitations",
        attributes: {
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          roles: input.roles,
          ...compact({ allAppsVisible: input.allAppsVisible, provisioningAllowed: input.provisioningAllowed }),
        },
        ...(input.visibleAppIds?.length ? { relationships: { visibleApps: relMany("apps", input.visibleAppIds) } } : {}),
      },
    } satisfies Schemas["UserInvitationCreateRequest"];
    return this.client.post("/v1/userInvitations", body, "userInvitations.create");
  }

  cancelInvitation(invitationId: string) {
    return this.client.delete(`/v1/userInvitations/${enc(invitationId)}`, undefined, "userInvitations.delete");
  }
}
