import { runRepositoryContract } from '@/test/repositoryContract'
import { createTestEnv } from '@/test/fixtures'

runRepositoryContract('LocalRepository', createTestEnv)
