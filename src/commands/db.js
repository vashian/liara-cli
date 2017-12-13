import axios from 'axios';
import { cyan, green } from 'chalk';
import auth from '../middlewares/auth';
import ora from 'ora';
import figures from 'figures';
import { prompt } from 'inquirer';

export default auth(async function deploy(args, config) {
  const { database } = await prompt({
    type: 'list',
    name: 'database',
    message: 'Select a database to deploy:',
    choices: ['MySQL', 'PostgreSQL', 'MongoDB', 'Redis'],
  });

  const spinner = ora(`Deploying ${database}`).start();

  try {
    const { data: { user, password, host, port, db_name } } = await axios.post(`/api/v1/databases`, {}, {
      baseURL: config.apiURL,
      headers: {
        Authorization: `Bearer ${config.api_token}`,
      }
    });

    spinner.stopAndPersist({
      symbol: green(figures.tick),
      text: 'Database created.'
    });

    const command = `mysql -u ${user} -p${password} -h ${host} -P ${port} ${db_name}`;
    const url = `mysql://${user}:${password}@${host}:${port}/${db_name}`;

    console.log();
    console.log(`    Connect via CLI: ${cyan(command)}`);
    console.log();
    console.log(`    Database URL: ${cyan(url)}`);
    console.log();
    
  } catch(err) {
    console.error(err);
  }
});
