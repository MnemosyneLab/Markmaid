## Deterministic section {{INDEX}}

MarkMaid fixture paragraph {{INDEX}} contains **bold**, _emphasis_, a
[local link](./notes-{{INDEX}}.md), and an image reference
![fixture image](./images/fixture-{{INDEX}}.png).

| Item | Value | Ready |
| --- | ---: | :---: |
| section | {{INDEX}} | yes |
| seed | markmaid-v0.1.7 | yes |

- [x] generated task {{INDEX}}
- [ ] pending task {{INDEX}}

```ts
export const fixture{{INDEX}} = "markmaid-performance";
```
Inline math $x_{{INDEX}} + y_{{INDEX}}$ and display math:

$$
f_{{INDEX}}(x) = x^2 + {{INDEX}}
$$

```mermaid
flowchart LR
  A{{INDEX}}[Load] --> B{{INDEX}}{Ready?}
  B{{INDEX}} -->|yes| C{{INDEX}}[Preview]
  B{{INDEX}} -->|no| D{{INDEX}}[Retry]
```
