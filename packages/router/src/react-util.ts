import type { ReactNode } from 'react'
import { Children, isValidElement } from 'react'

export function flattenAll(children: ReactNode): ReactNode[] {
  const childrenArray = Children.toArray(children)

  return childrenArray.flatMap((child) => {
    if (isValidElement(child)) {
      // https://github.com/facebook/react/issues/31824
      const childElement: React.ReactElement<any> = child

      if (childElement?.props.children) {
        return [child, ...flattenAll(childElement.props.children)]
      }
    }

    return [child]
  })
}
