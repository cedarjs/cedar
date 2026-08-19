import { test } from '@playwright/test'

import { aggregatedCellsTest } from '../../shared/aggregatedCells.ts'

test('Cell query aggregation with cedar serve', aggregatedCellsTest)
