import React from 'react'

type ComponentDidCatch = React.ComponentLifecycle<any, any>['componentDidCatch']

interface ErrorBoundaryProps {
  error?: unknown
  onError: NonNullable<ComponentDidCatch>
  children: React.ReactNode
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps> {
  componentDidCatch(...args: Parameters<NonNullable<ComponentDidCatch>>) {
    this.setState({})
    this.props.onError(...args)
  }

  render() {
    return this.props.children
  }
}
