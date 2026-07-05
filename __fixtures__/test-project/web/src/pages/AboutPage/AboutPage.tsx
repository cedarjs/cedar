import { Fraction } from 'fraction.js'

const AboutPage = () => {
  const half = new Fraction(1, 2).toFraction()
  return (
    <>
      <p className="font-light">
        This site was created to demonstrate my mastery of Cedar: Look on my
        works, ye mighty, and despair!
      </p>
      <p data-testid="fraction-test">Half is {half}</p>
    </>
  )
}

export default AboutPage
