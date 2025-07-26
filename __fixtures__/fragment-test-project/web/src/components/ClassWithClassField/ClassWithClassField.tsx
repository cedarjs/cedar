class Bar {}

class Foo {
  // Without the correct babel plugins this will throw an error
  public bar = new Bar()
}

const ClassWithClassField = () => {
  return <p>{new Foo().bar.toString()}</p>
}

export default ClassWithClassField
