import { execSync } from 'child_process'
import { DebugLogger } from './output';

export default function collectGitInfo(cwd: string, debug: DebugLogger) {
  const branch = retrieveConfig('git rev-parse --abbrev-ref HEAD', cwd, debug)
  const author = retrieveConfig('git log --format="%aE" -n 1 HEAD', cwd, debug)
  const message = retrieveConfig('git log --format="%B" -n 1 HEAD', cwd, debug)
  const commit = retrieveConfig('git rev-parse HEAD', cwd, debug)
  const committedAt = retrieveConfig('git log --format="%ct" -n 1 HEAD', cwd, debug)
  const tags = retrieveConfig('git tag --points-at', cwd, debug)

  return {
    branch,
    author,
    message,
    commit,
    committedAt,
    tags: tags && tags.split('\n'),
  }
}

function retrieveConfig(command: string, cwd: string, debug: DebugLogger) {
  try {
    return execSync(command, { cwd, stdio : 'pipe' }).toString().trim()
  } catch (error) {
    debug(error.message)
    return null;
  }
}
