export function extendDockerfile(platform, config) {
  if(typeof config !== 'object') {
    throw new TypeError('config must be an object.');
  }

  if(config.command) {
    
  }
}