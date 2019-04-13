import {expect} from '@oclif/test'

import fixture from './utils/fixture'
import getFiles from '../src/utils/get-files'
import validatePort from '../src/utils/validate-port'

describe('utils', () => {
  it('should throw an error for invalid liara.json file', async () => {
    expect(validatePort('asdf')).to.contain('number')
    expect(validatePort('3.2')).to.contain('integer')
    expect(validatePort('-3.2')).to.contain('integer')
    expect(validatePort('-80')).to.contain('integer')
    expect(validatePort('80')).to.be.eq(true)
    expect(validatePort('5000')).to.be.eq(true)
    expect(validatePort(5000)).to.be.eq(true)
    expect(validatePort(80)).to.be.eq(true)
  })

  it('should get files', async () => {
    // await getFiles(fixture('simple-gitignore'))
    // await getFiles(fixture('nested-ignore-files'))
    await getFiles(fixture('different-ignore-files'))
  })
})
