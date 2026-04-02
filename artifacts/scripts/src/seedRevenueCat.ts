import { getUncachableRevenueCatClient } from "./revenueCatClient";

import {
  listProjects,
  createProject,
  listApps,
  createApp,
  listAppPublicApiKeys,
  listProducts,
  createProduct,
  listEntitlements,
  createEntitlement,
  attachProductsToEntitlement,
  listOfferings,
  createOffering,
  updateOffering,
  listPackages,
  createPackages,
  attachProductsToPackage,
  type App,
  type Product,
  type Project,
  type Entitlement,
  type Offering,
  type Package,
  type CreateProductData,
} from "@replit/revenuecat-sdk";

const PROJECT_NAME = "Elovia";

const APP_STORE_APP_NAME = "Elovia iOS";
const APP_STORE_BUNDLE_ID = "com.elovia.app";
const PLAY_STORE_APP_NAME = "Elovia Android";
const PLAY_STORE_PACKAGE_NAME = "com.elovia.app";

const ENTITLEMENT_IDENTIFIER = "elovia_pro";
const ENTITLEMENT_DISPLAY_NAME = "Elovia Pro";

const OFFERING_IDENTIFIER = "default";
const OFFERING_DISPLAY_NAME = "Default Offering";

interface ProductConfig {
  identifier: string;
  playStoreIdentifier: string;
  displayName: string;
  title: string;
  duration: "P1M" | "P1Y";
  packageLookupKey: string;
  packageDisplayName: string;
  isLifetime: boolean;
  prices: { amount_micros: number; currency: string }[];
}

const PRODUCTS: ProductConfig[] = [
  {
    identifier: "elovia_pro_monthly",
    playStoreIdentifier: "elovia_pro_monthly:monthly",
    displayName: "Monthly Premium",
    title: "Monthly Premium",
    duration: "P1M",
    packageLookupKey: "$rc_monthly",
    packageDisplayName: "Monthly",
    isLifetime: false,
    prices: [
      { amount_micros: 4990000, currency: "USD" },
      { amount_micros: 4490000, currency: "EUR" },
      { amount_micros: 3990000, currency: "GBP" },
    ],
  },
  {
    identifier: "elovia_pro_yearly",
    playStoreIdentifier: "elovia_pro_yearly:yearly",
    displayName: "Yearly Premium",
    title: "Yearly Premium",
    duration: "P1Y",
    packageLookupKey: "$rc_annual",
    packageDisplayName: "Yearly",
    isLifetime: false,
    prices: [
      { amount_micros: 29990000, currency: "USD" },
      { amount_micros: 27990000, currency: "EUR" },
      { amount_micros: 23990000, currency: "GBP" },
    ],
  },
  {
    identifier: "elovia_pro_lifetime",
    playStoreIdentifier: "elovia_pro_lifetime:lifetime",
    displayName: "Lifetime Premium",
    title: "Lifetime Premium",
    duration: "P1Y",
    packageLookupKey: "$rc_lifetime",
    packageDisplayName: "Lifetime",
    isLifetime: true,
    prices: [
      { amount_micros: 79990000, currency: "USD" },
      { amount_micros: 74990000, currency: "EUR" },
      { amount_micros: 64990000, currency: "GBP" },
    ],
  },
];

type TestStorePricesResponse = {
  object: string;
  prices: { amount_micros: number; currency: string }[];
};

async function seedRevenueCat() {
  const client = await getUncachableRevenueCatClient();

  let project: Project;
  const { data: existingProjects, error: listProjectsError } = await listProjects({
    client,
    query: { limit: 20 },
  });

  if (listProjectsError) throw new Error("Failed to list projects");

  const existingProject = existingProjects.items?.find((p) => p.name === PROJECT_NAME);

  if (existingProject) {
    console.log("Project already exists:", existingProject.id);
    project = existingProject;
  } else {
    const { data: newProject, error: createProjectError } = await createProject({
      client,
      body: { name: PROJECT_NAME },
    });
    if (createProjectError) throw new Error("Failed to create project");
    console.log("Created project:", newProject.id);
    project = newProject;
  }

  const { data: apps, error: listAppsError } = await listApps({
    client,
    path: { project_id: project.id },
    query: { limit: 20 },
  });

  if (listAppsError || !apps || apps.items.length === 0) {
    throw new Error("No apps found");
  }

  let app: App | undefined = apps.items.find((a) => a.type === "test_store");
  let appStoreApp: App | undefined = apps.items.find((a) => a.type === "app_store");
  let playStoreApp: App | undefined = apps.items.find((a) => a.type === "play_store");

  if (!app) {
    throw new Error("No app with test store found");
  } else {
    console.log("App with test store found:", app.id);
  }

  if (!appStoreApp) {
    const { data: newApp, error } = await createApp({
      client,
      path: { project_id: project.id },
      body: {
        name: APP_STORE_APP_NAME,
        type: "app_store",
        app_store: { bundle_id: APP_STORE_BUNDLE_ID },
      },
    });
    if (error) throw new Error("Failed to create App Store app");
    appStoreApp = newApp;
    console.log("Created App Store app:", appStoreApp.id);
  } else {
    console.log("App Store app found:", appStoreApp.id);
  }

  if (!playStoreApp) {
    const { data: newApp, error } = await createApp({
      client,
      path: { project_id: project.id },
      body: {
        name: PLAY_STORE_APP_NAME,
        type: "play_store",
        play_store: { package_name: PLAY_STORE_PACKAGE_NAME },
      },
    });
    if (error) throw new Error("Failed to create Play Store app");
    playStoreApp = newApp;
    console.log("Created Play Store app:", playStoreApp.id);
  } else {
    console.log("Play Store app found:", playStoreApp.id);
  }

  const { data: existingProducts, error: listProductsError } = await listProducts({
    client,
    path: { project_id: project.id },
    query: { limit: 100 },
  });

  if (listProductsError) throw new Error("Failed to list products");

  const ensureProductForApp = async (
    targetApp: App,
    label: string,
    productIdentifier: string,
    isTestStore: boolean,
    config: ProductConfig,
  ): Promise<Product> => {
    const existingProduct = existingProducts.items?.find(
      (p) => p.store_identifier === productIdentifier && p.app_id === targetApp.id,
    );

    if (existingProduct) {
      console.log(`${label} product already exists: ${existingProduct.id}`);
      return existingProduct;
    }

    const body: CreateProductData["body"] = {
      store_identifier: productIdentifier,
      app_id: targetApp.id,
      type: config.isLifetime ? "non_consumable" : "subscription",
      display_name: config.displayName,
    };

    if (isTestStore && !config.isLifetime) {
      body.subscription = { duration: config.duration };
      body.title = config.title;
    } else if (isTestStore && config.isLifetime) {
      body.title = config.title;
    }

    const { data: createdProduct, error } = await createProduct({
      client,
      path: { project_id: project.id },
      body,
    });

    if (error) throw new Error(`Failed to create ${label} product: ${JSON.stringify(error)}`);
    console.log(`Created ${label} product: ${createdProduct.id}`);
    return createdProduct;
  };

  const allTestStoreProducts: Product[] = [];
  const allAppStoreProducts: Product[] = [];
  const allPlayStoreProducts: Product[] = [];

  for (const config of PRODUCTS) {
    console.log(`\n--- Setting up product: ${config.displayName} ---`);

    const testStoreProduct = await ensureProductForApp(app, `Test Store (${config.displayName})`, config.identifier, true, config);
    const appStoreProduct = await ensureProductForApp(appStoreApp, `App Store (${config.displayName})`, config.identifier, false, config);
    const playStoreProduct = await ensureProductForApp(playStoreApp, `Play Store (${config.displayName})`, config.playStoreIdentifier, false, config);

    allTestStoreProducts.push(testStoreProduct);
    allAppStoreProducts.push(appStoreProduct);
    allPlayStoreProducts.push(playStoreProduct);

    console.log(`Adding test store prices for ${config.displayName}...`);
    const apiKey = process.env.REVENUECAT_SECRET_API_KEY;
    for (const price of config.prices) {
      const priceResp = await fetch(
        `https://api.revenuecat.com/v2/projects/${project.id}/products/${testStoreProduct.id}/test_store_prices`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Accept": "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ prices: [price] }),
        },
      );
      if (priceResp.ok) {
        console.log(`  Added ${price.currency} price for ${config.displayName}`);
      } else {
        const priceErr = await priceResp.json().catch(() => null);
        if (priceErr?.type === "resource_already_exists") {
          console.log(`  ${price.currency} price already exists for ${config.displayName}`);
        } else {
          console.log(`  Warning: ${price.currency} price failed (${priceResp.status}):`, priceErr?.message || JSON.stringify(priceErr));
        }
      }
    }
  }

  const allProductIds = [
    ...allTestStoreProducts.map((p) => p.id),
    ...allAppStoreProducts.map((p) => p.id),
    ...allPlayStoreProducts.map((p) => p.id),
  ];

  let entitlement: Entitlement | undefined;
  const { data: existingEntitlements, error: listEntitlementsError } = await listEntitlements({
    client,
    path: { project_id: project.id },
    query: { limit: 20 },
  });

  if (listEntitlementsError) throw new Error("Failed to list entitlements");

  const existingEntitlement = existingEntitlements.items?.find((e) => e.lookup_key === ENTITLEMENT_IDENTIFIER);

  if (existingEntitlement) {
    console.log("\nEntitlement already exists:", existingEntitlement.id);
    entitlement = existingEntitlement;
  } else {
    const { data: newEntitlement, error } = await createEntitlement({
      client,
      path: { project_id: project.id },
      body: {
        lookup_key: ENTITLEMENT_IDENTIFIER,
        display_name: ENTITLEMENT_DISPLAY_NAME,
      },
    });
    if (error) {
      if (error.type === "resource_already_exists") {
        console.log("\nEntitlement already exists (from prior run), fetching...");
        const { data: refetch } = await listEntitlements({
          client,
          path: { project_id: project.id },
          query: { limit: 100 },
        });
        entitlement = refetch?.items?.find(
          (e: any) => e.lookup_key === ENTITLEMENT_IDENTIFIER || e.display_name === ENTITLEMENT_DISPLAY_NAME
        );
        if (!entitlement) throw new Error("Entitlement exists but could not be fetched");
        console.log("Found entitlement:", entitlement.id, "lookup_key:", entitlement.lookup_key);
      } else {
        throw new Error("Failed to create entitlement: " + JSON.stringify(error));
      }
    } else {
      console.log("\nCreated entitlement:", newEntitlement.id);
      entitlement = newEntitlement;
    }
  }

  const { error: attachEntitlementError } = await attachProductsToEntitlement({
    client,
    path: { project_id: project.id, entitlement_id: entitlement.id },
    body: { product_ids: allProductIds },
  });

  if (attachEntitlementError) {
    if (attachEntitlementError.type === "unprocessable_entity_error") {
      console.log("Products already attached to entitlement");
    } else {
      console.log("Warning: attach entitlement error:", JSON.stringify(attachEntitlementError));
    }
  } else {
    console.log("Attached all products to entitlement");
  }

  let offering: Offering | undefined;
  const { data: existingOfferings, error: listOfferingsError } = await listOfferings({
    client,
    path: { project_id: project.id },
    query: { limit: 20 },
  });

  if (listOfferingsError) throw new Error("Failed to list offerings");

  const existingOffering = existingOfferings.items?.find((o) => o.lookup_key === OFFERING_IDENTIFIER);

  if (existingOffering) {
    console.log("Offering already exists:", existingOffering.id);
    offering = existingOffering;
  } else {
    const { data: newOffering, error } = await createOffering({
      client,
      path: { project_id: project.id },
      body: {
        lookup_key: OFFERING_IDENTIFIER,
        display_name: OFFERING_DISPLAY_NAME,
      },
    });
    if (error) throw new Error("Failed to create offering");
    console.log("Created offering:", newOffering.id);
    offering = newOffering;
  }

  if (!offering.is_current) {
    const { error } = await updateOffering({
      client,
      path: { project_id: project.id, offering_id: offering.id },
      body: { is_current: true },
    });
    if (error) throw new Error("Failed to set offering as current");
    console.log("Set offering as current");
  }

  const { data: existingPackages, error: listPackagesError } = await listPackages({
    client,
    path: { project_id: project.id, offering_id: offering.id },
    query: { limit: 20 },
  });

  if (listPackagesError) throw new Error("Failed to list packages");

  for (let i = 0; i < PRODUCTS.length; i++) {
    const config = PRODUCTS[i];
    const testProduct = allTestStoreProducts[i];
    const appStoreProduct = allAppStoreProducts[i];
    const playStoreProduct = allPlayStoreProducts[i];

    const existingPkg = existingPackages.items?.find((p) => p.lookup_key === config.packageLookupKey);

    let pkg: Package;
    if (existingPkg) {
      console.log(`Package "${config.packageDisplayName}" already exists: ${existingPkg.id}`);
      pkg = existingPkg;
    } else {
      const { data: newPackage, error } = await createPackages({
        client,
        path: { project_id: project.id, offering_id: offering.id },
        body: {
          lookup_key: config.packageLookupKey,
          display_name: config.packageDisplayName,
        },
      });
      if (error) throw new Error(`Failed to create package "${config.packageDisplayName}": ${JSON.stringify(error)}`);
      console.log(`Created package "${config.packageDisplayName}": ${newPackage.id}`);
      pkg = newPackage;
    }

    const { error: attachPackageError } = await attachProductsToPackage({
      client,
      path: { project_id: project.id, package_id: pkg.id },
      body: {
        products: [
          { product_id: testProduct.id, eligibility_criteria: "all" },
          { product_id: appStoreProduct.id, eligibility_criteria: "all" },
          { product_id: playStoreProduct.id, eligibility_criteria: "all" },
        ],
      },
    });

    if (attachPackageError) {
      if (
        attachPackageError.type === "unprocessable_entity_error" &&
        attachPackageError.message?.includes("Cannot attach product")
      ) {
        console.log(`Skipping package attach for "${config.packageDisplayName}": already has products`);
      } else {
        console.log(`Warning: attach error for "${config.packageDisplayName}":`, JSON.stringify(attachPackageError));
      }
    } else {
      console.log(`Attached products to package "${config.packageDisplayName}"`);
    }
  }

  const { data: testStoreApiKeys, error: testStoreApiKeysError } = await listAppPublicApiKeys({
    client,
    path: { project_id: project.id, app_id: app.id },
  });
  if (testStoreApiKeysError) throw new Error("Failed to list public API keys for Test Store app");

  const { data: appStoreApiKeys, error: appStoreApiKeysError } = await listAppPublicApiKeys({
    client,
    path: { project_id: project.id, app_id: appStoreApp.id },
  });
  if (appStoreApiKeysError) throw new Error("Failed to list public API keys for App Store app");

  const { data: playStoreApiKeys, error: playStoreApiKeysError } = await listAppPublicApiKeys({
    client,
    path: { project_id: project.id, app_id: playStoreApp.id },
  });
  if (playStoreApiKeysError) throw new Error("Failed to list public API keys for Play Store app");

  console.log("\n====================");
  console.log("RevenueCat setup complete!");
  console.log("====================");
  console.log("Project ID:", project.id);
  console.log("Test Store App ID:", app.id);
  console.log("App Store App ID:", appStoreApp.id);
  console.log("Play Store App ID:", playStoreApp.id);
  console.log("Entitlement Identifier:", ENTITLEMENT_IDENTIFIER);
  console.log("");
  console.log("Public API Keys:");
  console.log("  Test Store:", testStoreApiKeys?.items.map((item) => item.key).join(", ") ?? "N/A");
  console.log("  App Store:", appStoreApiKeys?.items.map((item) => item.key).join(", ") ?? "N/A");
  console.log("  Play Store:", playStoreApiKeys?.items.map((item) => item.key).join(", ") ?? "N/A");
  console.log("");
  console.log("Products configured:");
  PRODUCTS.forEach((p) => {
    console.log(`  - ${p.displayName} (${p.identifier})`);
    p.prices.forEach((price) => {
      console.log(`      ${price.currency}: ${(price.amount_micros / 1000000).toFixed(2)}`);
    });
  });
  console.log("");
  console.log("Store these as environment variables:");
  console.log(`  EXPO_PUBLIC_REVENUECAT_TEST_API_KEY=${testStoreApiKeys?.items[0]?.key ?? "N/A"}`);
  console.log(`  EXPO_PUBLIC_REVENUECAT_IOS_API_KEY=${appStoreApiKeys?.items[0]?.key ?? "N/A"}`);
  console.log(`  EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY=${playStoreApiKeys?.items[0]?.key ?? "N/A"}`);
  console.log(`  REVENUECAT_PROJECT_ID=${project.id}`);
  console.log(`  REVENUECAT_TEST_STORE_APP_ID=${app.id}`);
  console.log(`  REVENUECAT_APPLE_APP_STORE_APP_ID=${appStoreApp.id}`);
  console.log(`  REVENUECAT_GOOGLE_PLAY_STORE_APP_ID=${playStoreApp.id}`);
  console.log("====================\n");
}

seedRevenueCat().catch(console.error);
