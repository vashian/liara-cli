import hash from './hash'
import ignore from 'ignore'
import * as klaw from 'klaw'
import * as fs from 'fs-extra'
import * as through2 from 'through2'
import {resolve, relative, join, basename, dirname} from 'path'

interface IFile {
  checksum: string,
  path: string,
  size: number,
  mode: number,
}

const defaultIgnores: string[] = [
  '.git',
  '.idea',
  '.vscode',
  '.gitignore',
  '.liaraignore',
  '.dockerignore',
  '*.*~',
  'node_modules',
  'bower_components',
]

const removeEmptyLines = (lines: string[]) => lines.filter(line => line.trim().length > 0)

function addIgnorePatterns(ignoreInstance: any, projectPath: string) {
  const loadIgnoreFile = (ignoreFilePath: string) => {
    const patterns = removeEmptyLines(
      fs.readFileSync(ignoreFilePath).toString().split('\n')
    )

    const relativeToProjectPath = patterns.map((pattern: any) => relative(projectPath, join(dirname(ignoreFilePath), pattern)))

    ignoreInstance.add(relativeToProjectPath)
  }

  return through2.obj(function (item, _, next) {
    const liaraignorePath = join(dirname(item.path), '.liaraignore')
    const dockerignorePath = join(dirname(item.path), '.dockerignore')
    const gitignorePath = join(dirname(item.path), '.gitignore')

    if (fs.existsSync(liaraignorePath)) {
      loadIgnoreFile(liaraignorePath)
    } else if (fs.existsSync(dockerignorePath)) {
      loadIgnoreFile(dockerignorePath)
    } else if (fs.existsSync(gitignorePath)) {
      loadIgnoreFile(gitignorePath)
    }

    this.push(item)
    return next()
  })
}

function ignoreFiles(ignoreInstance: any, projectPath: string) {
  return through2.obj(function (item, _, next) {
    const itemPath = relative(projectPath, item.path)

    if (itemPath) {
      if (!ignoreInstance.ignores(itemPath)) {
        this.push(item)
      } else {
        console.log('ignoring', item.path.replace(resolve(projectPath) + '/', ''))
      }
    }

    return next()
  })
}

export default async function getFiles(projectPath: string) {
  const mapHashesToFiles = new Map()
  const directories = []

  const ignoreInstance = ignore()

  await new Promise(resolve => {
    let files: IFile[] = []
    let tmpFiles: object[] = []

    klaw(projectPath)
      .pipe(addIgnorePatterns(ignoreInstance, projectPath))
      .pipe(ignoreFiles(ignoreInstance, projectPath))
      .on('data', file => tmpFiles.push(file))
      .on('end', () => {
        console.log(tmpFiles.map((file: any) => file.path))

        resolve()
      })
  })

  // flatten files
  // const files = Array
  //   .from(mapHashesToFiles)
  //   .reduce((prevFiles, [ checksum, { files } ]) => {
  //     return [
  //       ...prevFiles,
  //       ...files,
  //     ];
  //   }, []);

  // return { files, directories, mapHashesToFiles };
}
