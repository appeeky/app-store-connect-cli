import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AppStoreConnectClient } from "../client.js";
import { AscError } from "../errors.js";
import { compact, enc, listQuery, relMany, relOne, type JsonApiDocument, type ListOptions, type Resource } from "../jsonapi.js";
import type { BundleIdPlatform, Schemas } from "../types.js";

export type ProfileType = AttributesProfile["profileType"];
type AttributesProfile = Schemas["ProfileCreateRequest"]["data"]["attributes"];
export type DevicePlatform = Schemas["DeviceCreateRequest"]["data"]["attributes"]["platform"];

export class SigningApi {
  constructor(private readonly client: AppStoreConnectClient) {}

  // ── Bundle IDs ───────────────────────────────────────────────
  listBundleIds(
    options: ListOptions & { identifier?: string | string[]; platform?: BundleIdPlatform; name?: string } = {},
  ) {
    return this.client.list(
      "/v1/bundleIds",
      listQuery(options, { identifier: options.identifier, platform: options.platform, name: options.name }),
      options,
    );
  }

  getBundleId(bundleIdId: string) {
    return this.client.get(`/v1/bundleIds/${enc(bundleIdId)}`, { include: ["bundleIdCapabilities"] });
  }

  createBundleId(input: { identifier: string; name: string; platform: BundleIdPlatform; seedId?: string }) {
    const body: Schemas["BundleIdCreateRequest"] = {
      data: {
        type: "bundleIds",
        attributes: compact(input) as Schemas["BundleIdCreateRequest"]["data"]["attributes"],
      },
    };
    return this.client.post("/v1/bundleIds", body, "bundleIds.create");
  }

  deleteBundleId(bundleIdId: string) {
    return this.client.delete(`/v1/bundleIds/${enc(bundleIdId)}`, undefined, "bundleIds.delete");
  }

  listCapabilities(bundleIdId: string, options: ListOptions = {}) {
    return this.client.list(`/v1/bundleIds/${enc(bundleIdId)}/bundleIdCapabilities`, listQuery(options), options);
  }

  // ── Devices ──────────────────────────────────────────────────
  listDevices(
    options: ListOptions & { platform?: DevicePlatform; status?: "ENABLED" | "DISABLED"; udid?: string | string[]; name?: string } = {},
  ) {
    return this.client.list(
      "/v1/devices",
      listQuery(options, { platform: options.platform, status: options.status, udid: options.udid, name: options.name }),
      options,
    );
  }

  registerDevice(input: { name: string; udid: string; platform: DevicePlatform }) {
    const body: Schemas["DeviceCreateRequest"] = { data: { type: "devices", attributes: input } };
    return this.client.post("/v1/devices", body, "devices.create");
  }

  updateDevice(deviceId: string, attributes: { name?: string; status?: "ENABLED" | "DISABLED" }) {
    const body: Schemas["DeviceUpdateRequest"] = {
      data: { type: "devices", id: deviceId, attributes: compact(attributes) },
    };
    return this.client.patch(`/v1/devices/${enc(deviceId)}`, body, "devices.update");
  }

  // ── Certificates ─────────────────────────────────────────────
  listCertificates(options: ListOptions & { certificateType?: string | string[]; displayName?: string } = {}) {
    return this.client.list(
      "/v1/certificates",
      listQuery(options, { certificateType: options.certificateType, displayName: options.displayName }),
      options,
    );
  }

  getCertificate(certificateId: string) {
    return this.client.get(`/v1/certificates/${enc(certificateId)}`);
  }

  // ── Profiles ─────────────────────────────────────────────────
  listProfiles(
    options: ListOptions & { name?: string; profileType?: string | string[]; profileState?: "ACTIVE" | "INVALID" } = {},
  ) {
    return this.client.list(
      "/v1/profiles",
      listQuery(options, { name: options.name, profileType: options.profileType, profileState: options.profileState }),
      options,
    );
  }

  getProfile(profileId: string) {
    return this.client.get<JsonApiDocument<Resource>>(`/v1/profiles/${enc(profileId)}`, { include: ["bundleId"] });
  }

  createProfile(input: {
    name: string;
    profileType: ProfileType;
    bundleIdId: string;
    certificateIds: string[];
    deviceIds?: string[];
  }) {
    const body: Schemas["ProfileCreateRequest"] = {
      data: {
        type: "profiles",
        attributes: { name: input.name, profileType: input.profileType },
        relationships: {
          bundleId: relOne("bundleIds", input.bundleIdId),
          certificates: relMany("certificates", input.certificateIds),
          ...(input.deviceIds?.length ? { devices: relMany("devices", input.deviceIds) } : {}),
        },
      },
    };
    return this.client.post("/v1/profiles", body, "profiles.create");
  }

  deleteProfile(profileId: string) {
    return this.client.delete(`/v1/profiles/${enc(profileId)}`, undefined, "profiles.delete");
  }

  /** Decode a profile's content into the .mobileprovision bytes. */
  async profileBytes(profileId: string): Promise<{ name?: string; uuid?: string; bytes: Buffer }> {
    const doc = await this.getProfile(profileId);
    const content = doc.data.attributes?.profileContent;
    if (typeof content !== "string" || !content) {
      throw new AscError(`Profile ${profileId} has no content (it may be invalid or expired)`);
    }
    return {
      name: doc.data.attributes?.name as string | undefined,
      uuid: doc.data.attributes?.uuid as string | undefined,
      bytes: Buffer.from(content, "base64"),
    };
  }

  /** Write a profile to disk as a .mobileprovision / .provisionprofile file. */
  async downloadProfile(profileId: string, outputPath: string) {
    const { name, uuid, bytes } = await this.profileBytes(profileId);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, bytes);
    return { id: profileId, name, uuid, outputPath, bytes: bytes.length };
  }
}
