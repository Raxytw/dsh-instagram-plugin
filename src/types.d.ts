declare module 'cordis' {
  export interface Context {
    [key: string]: any
    instagramMcp?: any
  }
}

declare module '@deepseek-ai/schemastery' {
  const content: any
  export default content
}

declare module '@deepseek-ai/dsh-tools' {
  export function defineTool(options: any): any
}
