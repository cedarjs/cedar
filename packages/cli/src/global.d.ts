declare namespace NodeJS {
  interface Global {
    // TODO: Can we remove this, or does it affect RX apps?
    __dirname: string
  }
}
