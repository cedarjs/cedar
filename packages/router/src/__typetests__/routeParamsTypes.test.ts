import { describe, expect, test } from 'tstyche'

import type { RouteParams, ParamType } from '@cedarjs/router'

/**
 * FAQ:
 * - why aren't you using .toBeAssignable() in all tests?
 * because {b: string} is assignable to Record, and then test isn't accurate enough
 *
 * - why aren't you just checking the entire type?
 * because sometimes, the parser returns {Params & GenericParams} (and that's ok!), checking the full type will cause failures
 *
 * - why are you assigning the const values if you're just checking the types?
 * for readability: param?.id! everywhere is ugly - it helps with making these tests read like documentation
 *
 */

describe('RouteParams<>', () => {
  test('Single parameters', () => {
    const simple: RouteParams<'bazinga/{id:Int}'> = {
      id: 2,
    }

    expect(simple.id).type.toBe<number>()
  })

  test('Starts with parameter', () => {
    const startParam: RouteParams<'/{position:Int}/{driver:Float}/stats'> = {
      position: 1,
      driver: 44,
    }

    expect(startParam.driver).type.toBe<number>()
    expect(startParam.position).type.toBe<number>()
  })

  test('Route string with no types defaults to string', () => {
    const untypedParams: RouteParams<'/blog/{year}/{month}/{day}/{slug}'> = {
      year: '2020',
      month: '01',
      day: '01',
      slug: 'hello-world',
    }

    expect(untypedParams.year).type.toBe<string>()
    expect(untypedParams.month).type.toBe<string>()
    expect(untypedParams.day).type.toBe<string>()
    expect(untypedParams.slug).type.toBe<string>()
  })

  test('Custom param types', () => {
    const customParams: RouteParams<'/post/{name:slug}'> = {
      name: 'hello-world-slug',
    }

    expect(customParams.name).type.toBe<string>()
  })

  test('Parameter inside string', () => {
    const stringConcat: RouteParams<'/signedUp/e{status:Boolean}y'> = {
      status: true,
    }

    expect(stringConcat.status).type.toBe<boolean>()
  })

  test('Multiple Glob route params', () => {
    const globRoutes: RouteParams<'/from/{fromDate...}/to/{toDate...}'> = {
      fromDate: '2021/11/03',
      toDate: '2021/11/17',
    }

    expect(globRoutes.fromDate).type.toBe<string>()
    expect(globRoutes.toDate).type.toBe<string>()
  })

  test('Single Glob route params', () => {
    const globRoutes: RouteParams<'/from/{fromDate...}'> = {
      fromDate: '2021/11/03',
    }

    expect(globRoutes.fromDate).type.toBe<string>()
  })

  test('Starts with Glob route params', () => {
    const globRoutes: RouteParams<'/{description...}-little/kittens'> = {
      description: 'cute',
    }

    expect(globRoutes.description).type.toBe<string>()
  })

  test('Glob params in the middle', () => {
    const middleGlob: RouteParams<'/repo/{folders...}/edit'> = {
      folders: 'src/lib/auth.js',
    }

    expect(middleGlob.folders).type.toBe<string>()
  })

  test('Mixed typed and untyped params', () => {
    const untypedFirst: RouteParams<'/mixed/{b}/{c:Boolean}'> = {
      b: 'bazinga',
      c: true,
    }

    const typedFirst: RouteParams<'/mixed/{b:Float}/{c}'> = {
      b: 1245,
      c: 'stringy-string',
    }

    expect(untypedFirst.b).type.toBe<string>()
    expect(untypedFirst.c).type.toBe<boolean>()

    expect(typedFirst.b).type.toBe<number>()
    expect(typedFirst.c).type.toBe<string>()
  })

  test('Params in the middle', () => {
    const paramsInTheMiddle: RouteParams<'/posts/{authorId:string}/{id:Int}/edit'> =
      {
        authorId: 'id:author',
        id: 10,
      }

    expect(paramsInTheMiddle.authorId).type.toBe<string>()
    expect(paramsInTheMiddle.id).type.toBe<number>()
  })
})

describe('ParamType<>', () => {
  test('Float', () => {
    expect<ParamType<'Float'>>().type.toBeAssignableFrom(1.02)
  })

  test('Boolean', () => {
    expect<ParamType<'Boolean'>>().type.toBeAssignableFrom(true)
    expect<ParamType<'Boolean'>>().type.toBeAssignableFrom(false)
  })

  test('Int', () => {
    expect<ParamType<'Int'>>().type.toBeAssignableFrom(51)
  })

  test('String', () => {
    expect<ParamType<'String'>>().type.toBeAssignableFrom('bazinga')
  })
})
