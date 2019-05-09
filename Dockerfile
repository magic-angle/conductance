FROM node:8.9.4
MAINTAINER alex@onilabs.com

# Fix for moved repositories in Debian Jessie
RUN echo "deb [check-valid-until=no] http://cdn-fastly.deb.debian.org/debian jessie main" > /etc/apt/sources.list.d/jessie.list
RUN echo "deb [check-valid-until=no] http://archive.debian.org/debian jessie-backports main" > /etc/apt/sources.list.d/jessie-backports.list
RUN sed -i '/deb http:\/\/deb.debian.org\/debian jessie-updates main/d' /etc/apt/sources.list
RUN apt-get -o Acquire::Check-Valid-Until=false update

# install certbot (letsencrypt.org support) - see modules/services/https
RUN apt-get update -o Acquire::Check-Valid-Until=false \
    && apt-get -o Acquire::Check-Valid-Until=false -t jessie-backports install -y --no-install-recommends python-ndg-httpsclient \
    && apt-get -o Acquire::Check-Valid-Until=false -t jessie-backports install -y --no-install-recommends certbot \
    && rm -rf /var/lib/apt/lists/*

# install conductance
RUN mkdir -p /usr/src/conductance
WORKDIR /usr/src/conductance
COPY . /usr/src/conductance
RUN make && ln -s /usr/src/conductance/conductance /usr/local/bin/conductance

# VOLUME [ "/etc/conductance/certs/" ]

ENTRYPOINT [ "conductance" ]
