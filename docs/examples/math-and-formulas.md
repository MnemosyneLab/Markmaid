# Math and LaTeX formulas

Exercises inline and block math rendering with locally bundled KaTeX.

## Inline math

Einstein's famous equation is $E = mc^2$, where $E$ is energy, $m$ is mass, and $c$ is the speed of light.

Pythagorean theorem: $a^2 + b^2 = c^2$.

Calculus limit: $\lim_{x \to 0} \frac{\sin x}{x} = 1$.

## Display block math

Integral definition of Euler's Gamma function:

$$
\Gamma(z) = \int_0^\infty x^{z-1} e^{-x} dx
$$

Matrix equation:

$$
\begin{pmatrix} a & b \\ c & d \end{pmatrix} \begin{pmatrix} x \\ y \end{pmatrix} = \begin{pmatrix} ax + by \\ cx + dy \end{pmatrix}
$$

## Invalid TeX fallback

An unsupported or malformed TeX command shows a safe fallback without crashing:

$\invalidTeXCommand{foo}$

## Currency and code block exclusions (untouched text)

Currency values like $5.00 or $10.00 should remain plain text:
Item A costs $15.50 and Item B costs $20.00.

Code fences and inline code should NOT render as math:

```markdown
Here is raw math in Markdown source: $E = mc^2$ or $$a^2 + b^2 = c^2$$.
```

Inline code: `$a + b = c$`
