# grant-foundation

A tiny Express-based foundation inspired by
[gandhi](https://github.com/mike-marcacci/gandhi).

## Usage

```js
const express = require('express');
const grantFoundation = require('grant-foundation');

const app = express();
app.use(grantFoundation({ root: '/grants' }));

app.listen(3000);
```