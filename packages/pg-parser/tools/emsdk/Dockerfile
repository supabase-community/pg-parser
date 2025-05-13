FROM emscripten/emsdk

RUN apt-get update && apt-get install -y \
  autoconf \
  automake \
  libtool \
  pkg-config \
  protobuf-compiler \
  libprotoc-dev

# Install protobuf-c
RUN git clone --branch feat/json_name https://github.com/gregnr/protobuf-c.git /protobuf-c && \
  cd /protobuf-c && \
  ./autogen.sh && \
  ./configure && \
  make -j$(nproc) && \
  make install

RUN npm i -g typescript tsx
