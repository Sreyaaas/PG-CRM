import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'

// findBy*/waitFor give up after 1 s by default. On a loaded CI runner a page that fetches several queries can take
// longer than that, which made passing tests fail at random. Passing tests aren't slowed: the wait ends as soon as
// the element appears.
configure({ asyncUtilTimeout: 5000 })
