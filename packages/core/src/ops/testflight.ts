import { z } from "zod";
import type {
  BetaAppLocalizationAttributes,
  BetaAppReviewDetailAttributes,
  BetaGroupCreateAttributes,
  BetaGroupUpdateAttributes,
} from "../resources/testflight.js";
import { appId, id, ids, locale, page, pageOpts, pick, requireSome, str, strList, type AscOp } from "./shared.js";

const groupId = id("Beta group");
const GROUP_FIELDS = ["name", "publicLinkEnabled", "publicLinkLimitEnabled", "publicLinkLimit", "feedbackEnabled"] as const;
const groupShape = {
  publicLinkEnabled: z.boolean().optional(),
  publicLinkLimitEnabled: z.boolean().optional(),
  publicLinkLimit: z.number().int().min(1).max(10000).optional(),
  feedbackEnabled: z.boolean().optional(),
};

const BETA_LOC_FIELDS = ["description", "feedbackEmail", "marketingUrl", "privacyPolicyUrl", "tvOsPrivacyPolicy"] as const;
const betaLocShape = {
  description: z.string().max(4000).optional().describe("Beta app description"),
  feedbackEmail: z.string().email().optional(),
  marketingUrl: z.string().url().optional(),
  privacyPolicyUrl: z.string().url().optional(),
  tvOsPrivacyPolicy: z.string().optional(),
};

const BETA_REVIEW_FIELDS = [
  "contactFirstName",
  "contactLastName",
  "contactPhone",
  "contactEmail",
  "demoAccountName",
  "demoAccountPassword",
  "demoAccountRequired",
  "notes",
] as const;

export const TESTFLIGHT_OPS: AscOp[] = [
  // Groups
  {
    name: "appstore_list_beta_groups",
    group: "testflight",
    summary: "List TestFlight beta groups of an app",
    write: false,
    shape: { appId, name: z.string().optional(), isInternalGroup: z.boolean().optional(), ...page },
    run: (c, a) =>
      c.testflight.listGroups(str(a.appId, "appId"), {
        ...pageOpts(a),
        name: a.name as string | undefined,
        isInternalGroup: a.isInternalGroup as boolean | undefined,
      }),
  },
  {
    name: "appstore_get_beta_group",
    group: "testflight",
    summary: "Get a beta group (public link, limits, feedback setting)",
    write: false,
    shape: { groupId },
    run: (c, a) => c.testflight.getGroup(str(a.groupId, "groupId")),
  },
  {
    name: "appstore_create_beta_group",
    group: "testflight",
    summary: "Create a TestFlight beta group (internal or external)",
    write: true,
    shape: {
      appId,
      name: z.string().min(1),
      isInternalGroup: z.boolean().optional(),
      hasAccessToAllBuilds: z.boolean().optional().describe("Internal groups: get every build automatically"),
      ...groupShape,
    },
    run: (c, a) =>
      c.testflight.createGroup(
        str(a.appId, "appId"),
        pick<BetaGroupCreateAttributes>(a, [...GROUP_FIELDS, "isInternalGroup", "hasAccessToAllBuilds"]),
      ),
  },
  {
    name: "appstore_update_beta_group",
    group: "testflight",
    summary: "Rename a beta group or change its public link and feedback settings",
    write: true,
    shape: { groupId, name: z.string().optional(), ...groupShape },
    run: (c, a) => {
      const attrs = pick<BetaGroupUpdateAttributes>(a, GROUP_FIELDS);
      requireSome(attrs, "field");
      return c.testflight.updateGroup(str(a.groupId, "groupId"), attrs);
    },
  },
  {
    name: "appstore_delete_beta_group",
    group: "testflight",
    summary: "Delete a beta group",
    write: true,
    shape: { groupId },
    run: (c, a) => c.testflight.deleteGroup(str(a.groupId, "groupId")),
  },
  {
    name: "appstore_add_builds_to_beta_group",
    group: "testflight",
    summary: "Make builds available to a beta group",
    write: true,
    shape: { groupId, buildIds: ids("Build") },
    run: (c, a) => c.testflight.addBuildsToGroup(str(a.groupId, "groupId"), strList(a.buildIds, "buildIds")),
  },
  {
    name: "appstore_remove_builds_from_beta_group",
    group: "testflight",
    summary: "Remove builds from a beta group",
    write: true,
    shape: { groupId, buildIds: ids("Build") },
    run: (c, a) => c.testflight.removeBuildsFromGroup(str(a.groupId, "groupId"), strList(a.buildIds, "buildIds")),
  },
  {
    name: "appstore_add_testers_to_beta_group",
    group: "testflight",
    summary: "Add existing beta testers to a group",
    write: true,
    shape: { groupId, testerIds: ids("Beta tester") },
    run: (c, a) => c.testflight.addTestersToGroup(str(a.groupId, "groupId"), strList(a.testerIds, "testerIds")),
  },
  {
    name: "appstore_remove_testers_from_beta_group",
    group: "testflight",
    summary: "Remove beta testers from a group",
    write: true,
    shape: { groupId, testerIds: ids("Beta tester") },
    run: (c, a) => c.testflight.removeTestersFromGroup(str(a.groupId, "groupId"), strList(a.testerIds, "testerIds")),
  },
  // Testers
  {
    name: "appstore_list_beta_testers",
    group: "testflight",
    summary: "List beta testers (by app, group, build or email)",
    write: false,
    shape: {
      appId: z.string().optional().describe("Apple app id"),
      groupId: z.string().optional(),
      buildId: z.string().optional(),
      email: z.string().optional(),
      ...page,
    },
    run: (c, a) =>
      c.testflight.listTesters({
        ...pageOpts(a),
        appId: a.appId as string | undefined,
        groupId: a.groupId as string | undefined,
        buildId: a.buildId as string | undefined,
        email: a.email as string | undefined,
      }),
  },
  {
    name: "appstore_get_beta_tester",
    group: "testflight",
    summary: "Get a beta tester with their groups",
    write: false,
    shape: { testerId: id("Beta tester") },
    run: (c, a) => c.testflight.getTester(str(a.testerId, "testerId")),
  },
  {
    name: "appstore_invite_beta_tester",
    group: "testflight",
    summary: "Invite a tester by email into one or more beta groups",
    write: true,
    shape: {
      email: z.string().email(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      groupIds: z.array(z.string()).optional(),
      buildIds: z.array(z.string()).optional().describe("Individual builds (instead of groups)"),
    },
    run: (c, a) =>
      c.testflight.inviteTester({
        email: str(a.email, "email"),
        firstName: a.firstName as string | undefined,
        lastName: a.lastName as string | undefined,
        groupIds: a.groupIds as string[] | undefined,
        buildIds: a.buildIds as string[] | undefined,
      }),
  },
  {
    name: "appstore_send_beta_invitation",
    group: "testflight",
    summary: "Re-send the TestFlight invitation email to a tester for an app",
    write: true,
    shape: { appId, testerId: id("Beta tester") },
    run: (c, a) => c.testflight.sendInvitation(str(a.appId, "appId"), str(a.testerId, "testerId")),
  },
  {
    name: "appstore_delete_beta_tester",
    group: "testflight",
    summary: "Remove a beta tester from all of your apps",
    write: true,
    shape: { testerId: id("Beta tester") },
    run: (c, a) => c.testflight.deleteTester(str(a.testerId, "testerId")),
  },
  // Beta app localizations
  {
    name: "appstore_list_beta_app_localizations",
    group: "testflight",
    summary: "List TestFlight app descriptions and feedback emails per locale",
    write: false,
    shape: { appId, locale: z.string().optional(), ...page },
    run: (c, a) =>
      c.testflight.listAppLocalizations(str(a.appId, "appId"), { ...pageOpts(a), locale: a.locale as string | undefined }),
  },
  {
    name: "appstore_create_beta_app_localization",
    group: "testflight",
    summary: "Add TestFlight app info for a locale",
    write: true,
    shape: { appId, locale, ...betaLocShape },
    run: (c, a) =>
      c.testflight.createAppLocalization(
        str(a.appId, "appId"),
        str(a.locale, "locale"),
        pick<BetaAppLocalizationAttributes>(a, BETA_LOC_FIELDS),
      ),
  },
  {
    name: "appstore_update_beta_app_localization",
    group: "testflight",
    summary: "Update TestFlight app description, feedback email or URLs",
    write: true,
    shape: { localizationId: id("Beta app localization"), ...betaLocShape },
    run: (c, a) => {
      const attrs = pick<BetaAppLocalizationAttributes>(a, BETA_LOC_FIELDS);
      requireSome(attrs, "field");
      return c.testflight.updateAppLocalization(str(a.localizationId, "localizationId"), attrs);
    },
  },
  {
    name: "appstore_delete_beta_app_localization",
    group: "testflight",
    summary: "Delete TestFlight app info for a locale",
    write: true,
    shape: { localizationId: id("Beta app localization") },
    run: (c, a) => c.testflight.deleteAppLocalization(str(a.localizationId, "localizationId")),
  },
  // Beta App Review
  {
    name: "appstore_submit_for_beta_review",
    group: "testflight",
    summary: "Submit a build for Beta App Review (needed before external testing)",
    write: true,
    shape: { buildId: id("Build") },
    run: (c, a) => c.testflight.submitForBetaReview(str(a.buildId, "buildId")),
  },
  {
    name: "appstore_list_beta_review_submissions",
    group: "testflight",
    summary: "List Beta App Review submissions of a build",
    write: false,
    shape: { buildId: id("Build"), ...page },
    run: (c, a) => c.testflight.listBetaReviewSubmissions(str(a.buildId, "buildId"), pageOpts(a)),
  },
  {
    name: "appstore_get_beta_review_details",
    group: "testflight",
    summary: "Get Beta App Review contact, demo account and notes for an app",
    write: false,
    shape: { appId },
    run: (c, a) => c.testflight.getBetaReviewDetail(str(a.appId, "appId")),
  },
  {
    name: "appstore_update_beta_review_details",
    group: "testflight",
    summary: "Update Beta App Review contact, demo account or notes",
    write: true,
    shape: {
      detailId: id("Beta app review detail"),
      contactFirstName: z.string().optional(),
      contactLastName: z.string().optional(),
      contactPhone: z.string().optional(),
      contactEmail: z.string().email().optional(),
      demoAccountName: z.string().optional(),
      demoAccountPassword: z.string().optional(),
      demoAccountRequired: z.boolean().optional(),
      notes: z.string().optional(),
    },
    run: (c, a) => {
      const attrs = pick<BetaAppReviewDetailAttributes>(a, BETA_REVIEW_FIELDS);
      requireSome(attrs, "field");
      return c.testflight.updateBetaReviewDetail(str(a.detailId, "detailId"), attrs);
    },
  },
];
