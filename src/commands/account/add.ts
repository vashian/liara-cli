import axios from "axios";
import chalk from "chalk";
import fs from "fs-extra";
import retry from "async-retry";
import { prompt } from "inquirer";
import Command from "../../base";
import { flags } from "@oclif/command";
import promptEmail from "email-prompt-ts";
import eraseLines from "../../utils/erase-lines";
import { createDebugLogger } from "../../utils/output";
import { validate as validateEmail } from "email-validator";
import { GLOBAL_CONF_PATH, REGIONS_API_URL } from "../../constants";

interface IAccount {
  email: string;
  api_token: string;
  region: string;
}

interface IAccounts {
  [key: string]: IAccount;
}

interface ILiaraJson {
  api_token?: string;
  region?: string;
  current?: string;
  accounts?: IAccounts;
}

export default class AccountAdd extends Command {
  static description = "add an account";

  static flags = {
    ...Command.flags,
    name: flags.string({ char: "n", description: "account name" }),
    email: flags.string({ char: "e", description: "your email" }),
    password: flags.string({ char: "p", description: "your password" }),
  };

  async run() {
    const { flags } = this.parse(AccountAdd);
    const debug = createDebugLogger(flags.debug);
    const liara_json: ILiaraJson = this.gatherLiaraJson();
    const pervAccounts = this.gatherOtherAccounts();
    const name = flags.name ? flags.name : await this.promptName();
    const region = flags.region ? flags.region : await this.promptRegion();
    if (!flags.email) {
      let emailIsValid = false;
      do {
        flags.email = await this.promptEmail();
        emailIsValid = validateEmail(flags.email);
        if (!emailIsValid) {
          process.stdout.write(eraseLines(1));
        }
      } while (!emailIsValid);

      this.log();
    }
    const body = {
      email: flags.email,
      password: flags.password ? flags.password : await this.promptPassword(),
    };

    this.axiosConfig.baseURL = REGIONS_API_URL[region];

    const { api_token } = (await retry(
      async () => {
        try {
          const { data } = await axios.post(
            "/v1/login",
            body,
            this.axiosConfig
          );
          return data;
        } catch (err) {
          debug("retrying...");
          throw err;
        }
      },
      { retries: 3 }
    )) as { api_token: string };

    const accounts = {
      ...pervAccounts,
      [name]: {
        email: body.email,
        api_token,
        region,
      },
    };

    fs.writeFileSync(
      GLOBAL_CONF_PATH,
      JSON.stringify({
        api_token: liara_json.api_token,
        region: liara_json.region,
        current: liara_json.current,
        accounts,
      })
    );

    this.log(`> Auth credentials saved in ${chalk.bold(GLOBAL_CONF_PATH)}`);
    this.log(`> Current account is: ${liara_json.current}`);
  }

  async promptRegion(): Promise<string> {
    const { selectedRegion } = (await prompt({
      name: "selectedRegion",
      type: "list",
      message: "Please select a region:",
      choices: ["iran", "germany"],
    })) as { selectedRegion: string };

    return selectedRegion;
  }

  async promptName(): Promise<string> {
    const { name } = (await prompt({
      name: "name",
      type: "input",
      message: "enter your prefered name:",
      validate(input) {
        if (input.length === 0) {
          return false;
        } else {
          return true;
        }
      },
    })) as { name: string };
    const pervAccounts = await this.gatherOtherAccounts();
    const pervAccountsName = pervAccounts && Object.keys(pervAccounts);
    return pervAccountsName?.includes(name)
      ? this.error("this name in used for another account")
      : name;
  }

  async promptEmail(): Promise<string> {
    try {
      return await promptEmail({
        start: `${chalk.green("?")} ${chalk.bold("Enter your email:")} `,
      });
    } catch (err) {
      this.log(); // \n

      if (err.message === "User abort") {
        process.stdout.write(eraseLines(2));
        // tslint:disable-next-line: no-console
        console.log(`${chalk.red("> Aborted!")} No changes made.`);
        process.exit(0);
      }

      if (err.message === "stdin lacks setRawMode support") {
        this.error(
          `Interactive mode not supported – please run ${chalk.green(
            "liara login --email you@domain.com --password your_password"
          )}`
        );
      }

      throw err;
    }
  }

  async promptPassword(): Promise<string> {
    const { password } = (await prompt({
      name: "password",
      type: "password",
      message: "Enter your password:",
      validate(input) {
        if (input.length === 0) {
          return false;
        }
        return true;
      },
    })) as { password: string };

    return password;
  }

  gatherOtherAccounts(): Promise<object | undefined> {
    const accounts = fs.existsSync(GLOBAL_CONF_PATH)
      ? JSON.parse(fs.readFileSync(GLOBAL_CONF_PATH, "utf-8")).accounts
      : undefined;
    return accounts;
  }

  gatherLiaraJson() {
    const liara_json = fs.existsSync(GLOBAL_CONF_PATH)
      ? JSON.parse(fs.readFileSync(GLOBAL_CONF_PATH, "utf-8"))
      : undefined;
    return liara_json;
  }
}