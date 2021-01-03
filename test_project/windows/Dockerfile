FROM mcr.microsoft.com/windows/nanoserver:1809 AS data
RUN mkdir app
WORKDIR app
RUN date /T > now1.txt
RUN date /T > now2.txt
RUN date /T > now3.txt
RUN date /T > now4.txt
RUN date /T > now5.txt
RUN date /T > now6.txt
RUN date /T > now7.txt
RUN date /T > now8.txt
RUN date /T > now9.txt
RUN date /T > now10.txt
RUN date /T > now11.txt
RUN date /T > now12.txt
RUN date /T > now13.txt
RUN date /T > now14.txt
RUN date /T > now15.txt
RUN date /T > now16.txt

FROM scratch
RUN mkdir app
WORKDIR app
COPY --from=data app/now16.txt data_stage_built_at.txt
