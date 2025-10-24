2025-10-24

I've been agonizing over what name to use for the CedarJS CLI binary pretty much
since I first started working on Cedar. I've tried `cedarjs`, `cdr`, `cj`.
Nothing felt quite right. RedwoodJS, which this project is forked from, used
`redwood` and `rw`. But in reality everyone used `rw`, and it was also what most
of the documentation used. So I got used to the short and sweet `rw`.

In practice though, it's really more like `yarn rw`, so seven characters. Pretty
early I created an alias in my shell so I could just type `cedar` and it'd
expand to `yarn cedarjs`. That meant I only had to type five characters instead
of seven. And it felt really goot to use.

For the longest time I considered adding an optional step to the initial setup
of a Cedar app to add that alias to the user's shell configuration file. And
then just use `cedar dev`, `cedar build` etc in the documentation. I recently
realized though that doing that will only set it up for the person that first
creates the app. Everyone else working on it (everyone else in the user's team)
wouldn't be able to use that command. Also if you (or AI) works in ephemeral
environments the alias won't be available there. So I finally decided I would
_not_ have create-cedar-app add the alias.

At the same time I decided that, I also decided I have to start using the
command the documentation says to use, to get a feel for what my users would be
typing all day. So I added `cdr` as a short-form alternative of `cedarjs` and
started using `yarn cdr` for everything. But it just never felt quite right. It
just wasn't very nice to type out for some reason.

So now I'm trying `yarn cedar`. It's longer, but maybe it feels more natural.
Another bold move to try could be just `yarn c`. I kind of like that
`yarn cedar` is more explicit though, especially as I'm going to have to teach
AI to use this thing. If I go with `cedar` there's also the added benefit that
I can just maintain _one_ name for the cli binary.
