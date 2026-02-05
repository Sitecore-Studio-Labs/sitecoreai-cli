import { Command } from "commander";
import {
  runDeployOrganizationsGet,
  runDeployOrganizationsHealth,
  runDeployOrganizationsLicense,
  runDeployOrganizationsLaunchDemo,
} from "../../serialization/tasks";
import { addDeployBaseOptions } from "./shared";

export const createDeployOrganizationsCommand = (): Command => {
  const organizations = new Command("organizations")
    .description("Organization operations")
    .alias("org");

  const orgGet = new Command("get").description("Get the current organization");
  addDeployBaseOptions(orgGet);
  orgGet.action(async (options) => runDeployOrganizationsGet(options));

  const orgHealth = new Command("health").description("Get organization health");
  addDeployBaseOptions(orgHealth);
  orgHealth.action(async (options) => runDeployOrganizationsHealth(options));

  const orgLicense = new Command("license").description("Get organization license");
  addDeployBaseOptions(orgLicense);
  orgLicense.action(async (options) => runDeployOrganizationsLicense(options));

  const orgLaunchDemo = new Command("launch-demo").description("Launch demo solution");
  addDeployBaseOptions(orgLaunchDemo);
  orgLaunchDemo.action(async (options) => runDeployOrganizationsLaunchDemo(options));

  organizations.addCommand(orgGet);
  organizations.addCommand(orgHealth);
  organizations.addCommand(orgLaunchDemo);
  organizations.addCommand(orgLicense);

  return organizations;
};
