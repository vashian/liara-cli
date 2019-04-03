import hash from './hash';

const dockerfiles = {
  node: () => 'FROM liararepo/node-platform',
  static: () => 'FROM liararepo/static-platform',
  laravel: () => 'FROM liararepo/laravel-platform',
  angular: () => `FROM liararepo/angular-platform:builder as builder
FROM liararepo/angular-platform:nginx`,
  wordpress: () => 'FROM liararepo/wordpress-platform',
  python(platformConfig) {
    // TODO: Validate version, we have only 3 versions
    const defaultVersion = '3.7.1';
    let dockerfile = `FROM python-platform:${platformConfig.version || defaultVersion}`;

    if( ! platformConfig.command) {
      throw new Error('Please add `command` field to your liara.json file.');
    }

    dockerfile += `\nCMD ${platformConfig.command}`;

    return dockerfile;
  }
};

export default function ensureAppHasDockerfile(platform, platformConfig = {}, files, mapHashesToFiles) {
  if(platform === 'docker') {
    return {
      filesWithDockerfile: files,
      mapHashesToFilesWithDockerfile: mapHashesToFiles,
    };
  }

  let dockerfileContent = Buffer.from(dockerfiles[platform](platformConfig));
  const dockerfile = getFileObjectForDockerfile(dockerfileContent);

  return {
    filesWithDockerfile: [
      // Remove user-defined Dockerfile
      ...files.filter(file => file.path !== 'Dockerfile'),
  
      dockerfile,
    ],
    mapHashesToFilesWithDockerfile: (new Map(mapHashesToFiles)).set(dockerfile.checksum, {
      files: [...(mapHashesToFiles.get(dockerfile.checksum) || { files: [] }).files, 'Dockerfile'],
      data: dockerfileContent,
    }),
  };
}

function getFileObjectForDockerfile(dockerfileContent) {
  const dockerfile = {
    path: 'Dockerfile',
    mode: 33204, // _rw_rw_r__
    size: dockerfileContent.length,
    checksum: hash(dockerfileContent),
  };

  return dockerfile;
}