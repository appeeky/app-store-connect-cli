import { z } from "zod";
import type { DevicePlatform, ProfileType } from "../resources/signing.js";
import type { BundleIdPlatform } from "../types.js";
import { id, ids, page, pageOpts, str, strList, strOrArr, type AscOp } from "./shared.js";

const bundlePlatform = z.enum(["IOS", "MAC_OS", "UNIVERSAL"]);

export const SIGNING_OPS: AscOp[] = [
  {
    name: "appstore_list_bundle_ids",
    group: "signing",
    summary: "List registered bundle IDs (filter by identifier, platform, name)",
    write: false,
    shape: { identifier: strOrArr.optional(), platform: bundlePlatform.optional(), name: z.string().optional(), ...page },
    run: (c, a) =>
      c.signing.listBundleIds({
        ...pageOpts(a),
        identifier: a.identifier as string | undefined,
        platform: a.platform as BundleIdPlatform | undefined,
        name: a.name as string | undefined,
      }),
  },
  {
    name: "appstore_get_bundle_id",
    group: "signing",
    summary: "Get a bundle ID with its capabilities",
    write: false,
    shape: { bundleIdId: id("Bundle ID resource") },
    run: (c, a) => c.signing.getBundleId(str(a.bundleIdId, "bundleIdId")),
  },
  {
    name: "appstore_create_bundle_id",
    group: "signing",
    summary: "Register a new bundle ID",
    write: true,
    shape: {
      identifier: z.string().min(1).describe("e.g. com.example.app"),
      name: z.string().min(1),
      platform: bundlePlatform,
      seedId: z.string().optional().describe("Team id prefix"),
    },
    run: (c, a) =>
      c.signing.createBundleId({
        identifier: str(a.identifier, "identifier"),
        name: str(a.name, "name"),
        platform: a.platform as BundleIdPlatform,
        seedId: a.seedId as string | undefined,
      }),
  },
  {
    name: "appstore_delete_bundle_id",
    group: "signing",
    summary: "Delete a bundle ID",
    write: true,
    shape: { bundleIdId: id("Bundle ID resource") },
    run: (c, a) => c.signing.deleteBundleId(str(a.bundleIdId, "bundleIdId")),
  },
  {
    name: "appstore_list_bundle_id_capabilities",
    group: "signing",
    summary: "List capabilities enabled on a bundle ID",
    write: false,
    shape: { bundleIdId: id("Bundle ID resource"), ...page },
    run: (c, a) => c.signing.listCapabilities(str(a.bundleIdId, "bundleIdId"), pageOpts(a)),
  },
  {
    name: "appstore_list_devices",
    group: "signing",
    summary: "List registered devices",
    write: false,
    shape: {
      platform: bundlePlatform.optional(),
      status: z.enum(["ENABLED", "DISABLED"]).optional(),
      udid: strOrArr.optional(),
      name: z.string().optional(),
      ...page,
    },
    run: (c, a) =>
      c.signing.listDevices({
        ...pageOpts(a),
        platform: a.platform as DevicePlatform | undefined,
        status: a.status as "ENABLED" | "DISABLED" | undefined,
        udid: a.udid as string | undefined,
        name: a.name as string | undefined,
      }),
  },
  {
    name: "appstore_register_device",
    group: "signing",
    summary: "Register a device by UDID for development and ad hoc builds",
    write: true,
    shape: { name: z.string().min(1), udid: z.string().min(1), platform: bundlePlatform },
    run: (c, a) =>
      c.signing.registerDevice({
        name: str(a.name, "name"),
        udid: str(a.udid, "udid"),
        platform: a.platform as DevicePlatform,
      }),
  },
  {
    name: "appstore_update_device",
    group: "signing",
    summary: "Rename, enable or disable a registered device",
    write: true,
    shape: { deviceId: id("Device"), name: z.string().optional(), status: z.enum(["ENABLED", "DISABLED"]).optional() },
    run: (c, a) =>
      c.signing.updateDevice(str(a.deviceId, "deviceId"), {
        name: a.name as string | undefined,
        status: a.status as "ENABLED" | "DISABLED" | undefined,
      }),
  },
  {
    name: "appstore_list_certificates",
    group: "signing",
    summary: "List signing certificates (filter by type)",
    write: false,
    shape: {
      certificateType: strOrArr.optional().describe("e.g. DISTRIBUTION, DEVELOPMENT, DEVELOPER_ID_APPLICATION"),
      displayName: z.string().optional(),
      ...page,
    },
    run: (c, a) =>
      c.signing.listCertificates({
        ...pageOpts(a),
        certificateType: a.certificateType as string | undefined,
        displayName: a.displayName as string | undefined,
      }),
  },
  {
    name: "appstore_get_certificate",
    group: "signing",
    summary: "Get a certificate (includes its base64 content)",
    write: false,
    shape: { certificateId: id("Certificate") },
    run: (c, a) => c.signing.getCertificate(str(a.certificateId, "certificateId")),
  },
  {
    name: "appstore_list_profiles",
    group: "signing",
    summary: "List provisioning profiles (filter by name, type, state)",
    write: false,
    shape: {
      name: z.string().optional(),
      profileType: strOrArr.optional().describe("e.g. IOS_APP_STORE, IOS_APP_DEVELOPMENT, IOS_APP_ADHOC"),
      profileState: z.enum(["ACTIVE", "INVALID"]).optional(),
      ...page,
    },
    run: (c, a) =>
      c.signing.listProfiles({
        ...pageOpts(a),
        name: a.name as string | undefined,
        profileType: a.profileType as string | undefined,
        profileState: a.profileState as "ACTIVE" | "INVALID" | undefined,
      }),
  },
  {
    name: "appstore_get_profile",
    group: "signing",
    summary: "Get a provisioning profile (includes base64 profileContent)",
    write: false,
    shape: { profileId: id("Profile") },
    run: (c, a) => c.signing.getProfile(str(a.profileId, "profileId")),
  },
  {
    name: "appstore_create_profile",
    group: "signing",
    summary: "Create a provisioning profile for a bundle ID, certificates and (optionally) devices",
    write: true,
    shape: {
      name: z.string().min(1),
      profileType: z.string().min(1).describe("e.g. IOS_APP_STORE, IOS_APP_DEVELOPMENT, IOS_APP_ADHOC"),
      bundleIdId: id("Bundle ID resource"),
      certificateIds: ids("Certificate"),
      deviceIds: z.array(z.string()).optional().describe("Required for development and ad hoc profiles"),
    },
    run: (c, a) =>
      c.signing.createProfile({
        name: str(a.name, "name"),
        profileType: a.profileType as ProfileType,
        bundleIdId: str(a.bundleIdId, "bundleIdId"),
        certificateIds: strList(a.certificateIds, "certificateIds"),
        deviceIds: a.deviceIds as string[] | undefined,
      }),
  },
  {
    name: "appstore_delete_profile",
    group: "signing",
    summary: "Delete a provisioning profile",
    write: true,
    shape: { profileId: id("Profile") },
    run: (c, a) => c.signing.deleteProfile(str(a.profileId, "profileId")),
  },
  {
    name: "appstore_download_profile",
    group: "signing",
    summary: "Save a provisioning profile to a local .mobileprovision file",
    write: false,
    shape: {
      profileId: id("Profile"),
      outputPath: z.string().min(1).describe("Where to write the profile, e.g. ./App_Store.mobileprovision"),
    },
    run: (c, a) => c.signing.downloadProfile(str(a.profileId, "profileId"), str(a.outputPath, "outputPath")),
  },
];
